(function (global) {
  'use strict';

  // Zero-setup live multiplayer over public MQTT-over-WebSocket brokers (with automatic failover).
  // Optionally set DEFAULT_WS_URL (or window.ASCII_ROOM_WS_URL / ?ws=wss://...) to use your own
  // Cloudflare Durable Object Worker from multiplayer/ instead.
  const DEFAULT_WS_URL = '';

  const MQTT_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
  ];

  const IDLE_DISCONNECT_MS = 120_000; // Disconnect after 2 minutes without user input
  const HIDDEN_DISCONNECT_MS = 45_000; // Disconnect after 45s in a background tab
  const SEND_INTERVAL_MS = 100; // ~10 Hz state updates while moving
  const HEARTBEAT_MS = 18_000; // Refresh presence every 18s while active
  const MQTT_PING_MS = 20_000; // MQTT keepalive PINGREQ (keepAlive = 30s)
  const CONNECT_TIMEOUT_MS = 6_000; // Roll over to backup broker if connect stalls

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function resolveCustomWsUrl() {
    if (typeof global.ASCII_ROOM_WS_URL === 'string' && global.ASCII_ROOM_WS_URL.trim()) {
      return global.ASCII_ROOM_WS_URL.trim();
    }
    try {
      const params = new URLSearchParams(global.location.search);
      const fromQuery = params.get('ws');
      if (fromQuery && /^(wss?:)\/\//i.test(fromQuery)) {
        return fromQuery;
      }
    } catch (_) {}
    return DEFAULT_WS_URL;
  }

  function resolveRoomName() {
    try {
      const params = new URLSearchParams(global.location.search);
      const r = params.get('room');
      if (r && /^[a-zA-Z0-9_-]{1,32}$/.test(r)) return r;
    } catch (_) {}
    return 'main';
  }

  function randomId() {
    const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < 8; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  function roundN(v, digits) {
    const f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  // --- Minimal RFC-compliant MQTT 3.1.1 binary packet helpers ---
  function encodeVarLen(len) {
    const out = [];
    let x = len;
    do {
      let b = x & 0x7f;
      x >>= 7;
      if (x > 0) b |= 0x80;
      out.push(b);
    } while (x > 0);
    return out;
  }

  function encodeUtf8Str(str) {
    const bytes = encoder.encode(str);
    const out = new Uint8Array(2 + bytes.length);
    out[0] = (bytes.length >> 8) & 0xff;
    out[1] = bytes.length & 0xff;
    out.set(bytes, 2);
    return out;
  }

  function concatBytes(parts) {
    let total = 0;
    for (let i = 0; i < parts.length; i++) total += parts[i].length;
    const out = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], off);
      off += parts[i].length;
    }
    return out;
  }

  function buildPacket(headerByte, body) {
    const rl = encodeVarLen(body.length);
    const out = new Uint8Array(1 + rl.length + body.length);
    out[0] = headerByte;
    for (let i = 0; i < rl.length; i++) out[1 + i] = rl[i];
    out.set(body, 1 + rl.length);
    return out;
  }

  function buildConnectPacket(clientId, willTopic, willMessage) {
    // Variable header: "MQTT" (level 4), flags = CleanSession (0x02) | WillFlag (0x04), keepAlive = 30s
    const varHdr = concatBytes([
      encodeUtf8Str('MQTT'),
      new Uint8Array([0x04, 0x06, 0x00, 0x1e]),
    ]);
    const payload = concatBytes([
      encodeUtf8Str(clientId),
      encodeUtf8Str(willTopic),
      encodeUtf8Str(willMessage),
    ]);
    return buildPacket(0x10, concatBytes([varHdr, payload]));
  }

  function buildSubscribePacket(packetId, topicFilter) {
    const varHdr = new Uint8Array([(packetId >> 8) & 0xff, packetId & 0xff]);
    const payload = concatBytes([encodeUtf8Str(topicFilter), new Uint8Array([0x00])]);
    return buildPacket(0x82, concatBytes([varHdr, payload]));
  }

  function buildPublishPacket(topic, message) {
    const topicBytes = encodeUtf8Str(topic);
    const msgBytes = encoder.encode(message);
    return buildPacket(0x30, concatBytes([topicBytes, msgBytes]));
  }

  const MQTT_PINGREQ = new Uint8Array([0xc0, 0x00]);
  const MQTT_DISCONNECT = new Uint8Array([0xe0, 0x00]);

  class CatMultiplayer {
    constructor(room, onStatusChange) {
      this.room = room;
      this.onStatusChange = onStatusChange || null;
      this.customWsUrl = resolveCustomWsUrl();
      this.mode = this.customWsUrl ? 'raw' : 'mqtt';
      this.roomName = resolveRoomName();
      this.topicBase = `1matthewli_github_io/meadow_v1/${this.roomName}`;

      this.brokerIndex = 0;
      this.clientId = randomId();
      this.seed = Math.floor(Math.random() * 10000);
      this.packetId = 1;

      this.ws = null;
      this.rxBuf = new Uint8Array(0);
      this.connected = false;
      this.idleDisconnected = false;
      this.lastActivityAt = Date.now();
      this.hiddenSince = null;

      this.reconnectAttempts = 0;
      this.reconnectTimer = null;
      this.connectTimeout = null;
      this.lastSendAt = 0;
      this.lastHeartbeatAt = 0;
      this.lastPingAt = 0;
      this.lastSentKey = '';
      this.lastMeowSent = '';
      this.lastMeowTimer = 0;
      this.lastHiReplyAt = 0;

      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.hiddenSince = Date.now();
        } else {
          this.hiddenSince = null;
          this.markActive();
        }
      });

      const onUnload = () => this.sendLeaveAndClose();
      global.addEventListener('pagehide', onUnload);
      global.addEventListener('beforeunload', onUnload);

      this.connect();
    }

    isEnabled() {
      return true;
    }

    markActive() {
      this.lastActivityAt = Date.now();
      if (this.idleDisconnected) {
        this.idleDisconnected = false;
        this.reconnectAttempts = 0;
        this.connect();
      }
    }

    connect() {
      if (this.ws || this.idleDisconnected) return;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      const targetUrl =
        this.mode === 'raw'
          ? this.customWsUrl
          : MQTT_BROKERS[this.brokerIndex % MQTT_BROKERS.length];

      let ws;
      try {
        ws = this.mode === 'mqtt' ? new WebSocket(targetUrl, 'mqtt') : new WebSocket(targetUrl);
      } catch (_) {
        this.failoverAndReconnect();
        return;
      }

      if (this.mode === 'mqtt') {
        ws.binaryType = 'arraybuffer';
      }

      this.ws = ws;
      this.rxBuf = new Uint8Array(0);

      if (this.connectTimeout) clearTimeout(this.connectTimeout);
      this.connectTimeout = setTimeout(() => {
        if (this.ws === ws && !this.connected) {
          try {
            ws.close();
          } catch (_) {}
        }
      }, CONNECT_TIMEOUT_MS);

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        if (this.mode === 'raw') {
          this.onReady();
        } else {
          const mqttClientId = `mlcat_${this.clientId}`;
          const willTopic = `${this.topicBase}/leave`;
          const willPayload = JSON.stringify({ t: 'leave', id: this.clientId });
          try {
            ws.send(buildConnectPacket(mqttClientId, willTopic, willPayload));
          } catch (_) {
            try {
              ws.close();
            } catch (__) {}
          }
        }
      });

      ws.addEventListener('message', (evt) => {
        if (this.ws !== ws) return;
        if (this.mode === 'raw') {
          if (typeof evt.data === 'string') this.handleAppJson(evt.data);
          return;
        }
        if (evt.data instanceof ArrayBuffer) {
          this.handleMqttBytes(new Uint8Array(evt.data));
        }
      });

      ws.addEventListener('close', (evt) => {
        if (this.connectTimeout) {
          clearTimeout(this.connectTimeout);
          this.connectTimeout = null;
        }
        const wasConnected = this.connected;
        if (this.ws === ws) {
          this.ws = null;
          this.connected = false;
        }
        this.room.clearRemoteCats();
        this.notifyStatus();

        if (evt.code === 4000) {
          this.idleDisconnected = true;
          return;
        }
        if (!this.idleDisconnected) {
          if (!wasConnected && this.mode === 'mqtt') {
            this.brokerIndex = (this.brokerIndex + 1) % MQTT_BROKERS.length;
          }
          this.scheduleReconnect();
        }
      });

      ws.addEventListener('error', () => {
        try {
          ws.close();
        } catch (_) {}
      });
    }

    onReady() {
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }
      this.connected = true;
      this.reconnectAttempts = 0;
      this.lastSentKey = '';
      this.lastPingAt = Date.now();
      this.lastHeartbeatAt = Date.now();
      if (this.mode === 'mqtt') {
        this.publishMqtt(`${this.topicBase}/hi`, { t: 'hi', id: this.clientId });
      }
      this.sendState(true);
      this.notifyStatus();
    }

    handleMqttBytes(chunk) {
      this.rxBuf = this.rxBuf.length === 0 ? chunk : concatBytes([this.rxBuf, chunk]);
      const buf = this.rxBuf;
      let offset = 0;

      while (offset + 2 <= buf.length) {
        const header = buf[offset];
        const type = header >> 4;

        // Decode MQTT variable-length remaining length
        let mult = 1;
        let remLen = 0;
        let pos = offset + 1;
        let encodedByte = 0;
        let complete = false;
        while (pos < buf.length) {
          encodedByte = buf[pos++];
          remLen += (encodedByte & 0x7f) * mult;
          if ((encodedByte & 0x80) === 0) {
            complete = true;
            break;
          }
          mult *= 128;
          if (mult > 2_097_152) {
            // Corrupt framing -> reset connection
            try {
              this.ws && this.ws.close();
            } catch (_) {}
            return;
          }
        }
        if (!complete || pos + remLen > buf.length) break;

        const pktStart = pos;
        const pktEnd = pos + remLen;
        offset = pktEnd;

        if (type === 2) {
          // CONNACK
          const rc = remLen >= 2 ? buf[pktStart + 1] : 1;
          if (rc === 0 && this.ws && this.ws.readyState === WebSocket.OPEN) {
            const sub = buildSubscribePacket(this.packetId++, `${this.topicBase}/#`);
            try {
              this.ws.send(sub);
            } catch (_) {}
          } else {
            try {
              this.ws && this.ws.close();
            } catch (_) {}
            return;
          }
        } else if (type === 9) {
          // SUBACK -> ready to publish & receive peers!
          if (!this.connected) {
            this.onReady();
          }
        } else if (type === 3) {
          // PUBLISH
          if (remLen < 2) continue;
          const topicLen = (buf[pktStart] << 8) | buf[pktStart + 1];
          const qos = (header >> 1) & 0x03;
          const payloadStart = pktStart + 2 + topicLen + (qos > 0 ? 2 : 0);
          if (payloadStart > pktEnd) continue;
          const payloadText = decoder.decode(buf.subarray(payloadStart, pktEnd));
          this.handleAppJson(payloadText);
        }
      }

      this.rxBuf = offset > 0 ? buf.subarray(offset) : buf;
    }

    handleAppJson(text) {
      if (typeof text !== 'string' || text.length > 512) return;
      let msg;
      try {
        msg = JSON.parse(text);
      } catch (_) {
        return;
      }
      if (!msg || typeof msg.t !== 'string') return;

      // Ignore our own echoed MQTT messages
      if (msg.id && msg.id === this.clientId && msg.t !== 'init') return;

      if (msg.t === 'init') {
        this.clientId = msg.id || this.clientId;
        this.room.clearRemoteCats();
        if (Array.isArray(msg.peers)) {
          for (let i = 0; i < msg.peers.length; i++) {
            this.room.upsertRemoteCat(msg.peers[i]);
          }
        }
        this.notifyStatus();
      } else if (msg.t === 'hi' && msg.id) {
        // A new visitor joined — reply with our current state so they see us immediately!
        const now = Date.now();
        if (now - this.lastHiReplyAt > 400) {
          this.lastHiReplyAt = now;
          this.sendState(true);
        }
      } else if (msg.t === 'join' && msg.peer) {
        this.room.upsertRemoteCat(msg.peer);
        this.notifyStatus();
      } else if (msg.t === 's' && msg.id) {
        this.room.upsertRemoteCat(msg);
        this.notifyStatus();
      } else if (msg.t === 'y' && msg.id) {
        this.room.applyRemoteYarn(msg.x, msg.y, msg.vx, msg.vy);
      } else if (msg.t === 'leave' && msg.id) {
        this.room.removeRemoteCat(msg.id);
        this.notifyStatus();
      }
    }

    publishMqtt(topic, payloadObj) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      try {
        this.ws.send(buildPublishPacket(topic, JSON.stringify(payloadObj)));
      } catch (_) {}
    }

    sendLeaveAndClose() {
      const ws = this.ws;
      if (!ws) return;
      this.ws = null;
      this.connected = false;
      if (ws.readyState === WebSocket.OPEN) {
        try {
          if (this.mode === 'mqtt') {
            ws.send(buildPublishPacket(`${this.topicBase}/leave`, JSON.stringify({ t: 'leave', id: this.clientId })));
            ws.send(MQTT_DISCONNECT);
          }
          ws.close(1000, 'idle');
        } catch (_) {}
      }
    }

    disconnectIdle() {
      if (this.idleDisconnected) return;
      this.idleDisconnected = true;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      if (this.connectTimeout) {
        clearTimeout(this.connectTimeout);
        this.connectTimeout = null;
      }
      this.sendLeaveAndClose();
      this.room.clearRemoteCats();
      this.notifyStatus();
    }

    failoverAndReconnect() {
      if (this.mode === 'mqtt') {
        this.brokerIndex = (this.brokerIndex + 1) % MQTT_BROKERS.length;
      }
      this.scheduleReconnect();
    }

    scheduleReconnect() {
      if (this.idleDisconnected || this.reconnectTimer) return;
      const delay = Math.min(15_000, 1000 * Math.pow(2, Math.min(this.reconnectAttempts, 4)));
      this.reconnectAttempts++;
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    }

    buildFlags(c) {
      return (
        (c.inBox ? 1 : 0) |
        (c.inPond ? 2 : 0) |
        (c.shakeTimer > 0 ? 4 : 0) |
        (c.purrLevel > 0.24 ? 8 : 0)
      );
    }

    sendState(force) {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const now = Date.now();
      const c = this.room.cat;

      const meowActive = c.meowTimer > 0 && c.meowText;
      const freshMeow = meowActive && (c.meowTimer > this.lastMeowTimer + 0.2 || c.meowText !== this.lastMeowSent);
      this.lastMeowTimer = c.meowTimer;

      if (!force && !freshMeow && now - this.lastSendAt < SEND_INTERVAL_MS) return;

      const cols = Math.max(1, this.room.cols);
      const rows = Math.max(1, this.room.rows);
      const x = roundN(c.x / cols, 4);
      const y = roundN(c.y / rows, 4);
      const p = c.pose;
      const sc = roundN(c.scale, 2);
      const b = this.buildFlags(c);
      const w = roundN(c.wetness || 0, 2);
      const m = freshMeow ? c.meowText : '';
      if (freshMeow) this.lastMeowSent = c.meowText;

      const key = `${x}|${y}|${p}|${sc}|${b}|${w}`;
      if (!force && !freshMeow && key === this.lastSentKey) return;

      this.lastSentKey = key;
      this.lastSendAt = now;
      this.lastHeartbeatAt = now;
      const recentlyActive = now - this.lastActivityAt < 10_000 ? 1 : 0;

      const payload = { t: 's', id: this.clientId, seed: this.seed, x, y, p, sc, b, w, a: recentlyActive };
      if (m) payload.m = m;

      if (this.mode === 'mqtt') {
        this.publishMqtt(`${this.topicBase}/s`, payload);
      } else {
        try {
          this.ws.send(JSON.stringify(payload));
        } catch (_) {}
      }
    }

    sendYarnImpulse(x, y, vx, vy) {
      if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const cols = Math.max(1, this.room.cols);
      const rows = Math.max(1, this.room.rows);
      const payload = {
        t: 'y',
        id: this.clientId,
        x: roundN(x / cols, 4),
        y: roundN(y / rows, 4),
        vx: roundN(vx / cols, 3),
        vy: roundN(vy / rows, 3),
      };
      if (this.mode === 'mqtt') {
        this.publishMqtt(`${this.topicBase}/y`, payload);
      } else {
        try {
          this.ws.send(JSON.stringify(payload));
        } catch (_) {}
      }
    }

    tick() {
      const now = Date.now();

      if (this.connected) {
        const idleMs = now - this.lastActivityAt;
        const hiddenMs = this.hiddenSince ? now - this.hiddenSince : 0;
        if (idleMs >= IDLE_DISCONNECT_MS || hiddenMs >= HIDDEN_DISCONNECT_MS) {
          this.disconnectIdle();
          return;
        }

        this.sendState(false);

        // Periodic presence heartbeat while active so peers never mis-prune a stationary cat
        if (now - this.lastHeartbeatAt >= HEARTBEAT_MS) {
          this.sendState(true);
        }

        // Keepalive ping
        if (now - this.lastPingAt >= MQTT_PING_MS) {
          this.lastPingAt = now;
          try {
            if (this.mode === 'mqtt') {
              this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.send(MQTT_PINGREQ);
            } else {
              const activeFlag = idleMs < 28_000 ? 1 : 0;
              this.ws && this.ws.readyState === WebSocket.OPEN && this.ws.send(JSON.stringify({ t: 'ping', a: activeFlag }));
            }
          } catch (_) {}
        }
      }
    }

    notifyStatus() {
      if (typeof this.onStatusChange === 'function') {
        this.onStatusChange({
          connected: this.connected,
          remoteCount: this.room.remoteCats.size,
          idleDisconnected: this.idleDisconnected,
        });
      }
    }
  }

  global.CatMultiplayer = CatMultiplayer;
})(window);
