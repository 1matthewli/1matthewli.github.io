// Cloudflare Worker + Durable Object (WebSocket Hibernation API)
// Free-tier friendly multiplayer relay for 1matthewli.github.io
// - Scales comfortably to dozens/hundreds of concurrent cats
// - Hibernates at 0 cost when idle
// - Enforces strict server-side inactivity timeout (2 minutes) so ghost cats vanish

const MAX_CATS = 40;
const IDLE_TIMEOUT_MS = 120_000; // 2 minutes of inactivity -> disconnect
const SWEEP_INTERVAL_MS = 30_000; // Alarm sweep every 30s while cats are present
const MIN_MSG_INTERVAL_MS = 45; // Soft rate limit (~22 msgs/sec max per client)

const VALID_POSES = new Set([
  'sit', 'right', 'left', 'up', 'down', 'loaf', 'sleep', 'groom', 'box',
]);

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function roundN(v, digits) {
  const f = Math.pow(10, digits);
  return Math.round(v * f) / f;
}

function sanitizeState(raw) {
  const x = typeof raw.x === 'number' && isFinite(raw.x) ? roundN(clamp(raw.x, 0.02, 0.98), 4) : 0.5;
  const y = typeof raw.y === 'number' && isFinite(raw.y) ? roundN(clamp(raw.y, 0.08, 0.96), 4) : 0.6;
  const p = typeof raw.p === 'string' && VALID_POSES.has(raw.p) ? raw.p : 'sit';
  const sc = typeof raw.sc === 'number' && isFinite(raw.sc) ? roundN(clamp(raw.sc, 0.8, 6.5), 2) : 1.0;
  const b = typeof raw.b === 'number' && isFinite(raw.b) ? (raw.b | 0) & 31 : 0;
  const w = typeof raw.w === 'number' && isFinite(raw.w) ? roundN(clamp(raw.w, 0, 1), 2) : 0;
  const m = typeof raw.m === 'string' ? raw.m.slice(0, 18).replace(/[^\x20-\x7E]/g, '') : '';
  return { x, y, p, sc, b, w, m };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response('ok', {
        status: 200,
        headers: { 'access-control-allow-origin': '*' },
      });
    }

    if (url.pathname === '/ws' || url.pathname === '/') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('WebSocket endpoint for 1matthewli.github.io cat meadow', {
          status: 200,
          headers: { 'access-control-allow-origin': '*' },
        });
      }
      const roomName = (url.searchParams.get('room') || 'main').slice(0, 32);
      const id = env.MEADOW.idFromName(roomName);
      const stub = env.MEADOW.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};

export class MeadowRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const activeSockets = this.ctx.getWebSockets();
    if (activeSockets.length >= MAX_CATS) {
      return new Response('Meadow is full right now', { status: 503 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const catId = crypto.randomUUID().slice(0, 8);
    const now = Date.now();
    const initialAttachment = {
      id: catId,
      seed: Math.floor(Math.random() * 10000),
      joinedAt: now,
      lastActive: now,
      lastMsgAt: 0,
      state: { x: 0.5, y: 0.6, p: 'sit', sc: 1.0, b: 0, w: 0, m: '' },
    };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(initialAttachment);

    // Build snapshot of existing peers for the newly joined visitor
    const peers = [];
    for (const ws of activeSockets) {
      try {
        const att = ws.deserializeAttachment();
        if (att && att.id && att.id !== catId) {
          peers.push({ id: att.id, seed: att.seed, ...att.state, m: '' });
        }
      } catch (_) {}
    }

    try {
      server.send(JSON.stringify({ t: 'init', id: catId, seed: initialAttachment.seed, peers }));
    } catch (_) {}

    // Announce the new visitor to everyone else
    this.broadcast({ t: 'join', peer: { id: catId, seed: initialAttachment.seed, ...initialAttachment.state } }, server);

    // Ensure periodic inactivity sweep alarm is scheduled
    await this.ensureAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  async ensureAlarm() {
    const existing = await this.ctx.storage.getAlarm();
    if (!existing) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }

  broadcast(payload, exceptWs) {
    const text = JSON.stringify(payload);
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      if (ws === exceptWs) continue;
      try {
        ws.send(text);
      } catch (_) {
        try {
          ws.close(1011, 'send failed');
        } catch (__) {}
      }
    }
  }

  async webSocketMessage(ws, message) {
    if (typeof message !== 'string' || message.length > 512) return;

    const att = ws.deserializeAttachment();
    if (!att || !att.id) return;

    const now = Date.now();
    if (now - (att.lastMsgAt || 0) < MIN_MSG_INTERVAL_MS) return;

    let data;
    try {
      data = JSON.parse(message);
    } catch (_) {
      return;
    }

    if (!data || typeof data.t !== 'string') return;

    if (data.t === 's') {
      const next = sanitizeState(data);
      const changed =
        Math.abs(next.x - att.state.x) > 0.0005 ||
        Math.abs(next.y - att.state.y) > 0.0005 ||
        next.p !== att.state.p ||
        next.sc !== att.state.sc ||
        next.b !== att.state.b ||
        next.m !== '';

      att.lastMsgAt = now;
      // Only refresh inactivity clock when the user actually moved/interacted (or explicitly sent active flag)
      if (changed || data.a === 1) {
        att.lastActive = now;
      }
      att.state = { ...next, m: '' };
      ws.serializeAttachment(att);

      this.broadcast({ t: 's', id: att.id, ...next }, ws);
    } else if (data.t === 'y') {
      // Shared yarn ball bat impulse
      const x = typeof data.x === 'number' && isFinite(data.x) ? roundN(clamp(data.x, 0.04, 0.96), 4) : 0.5;
      const y = typeof data.y === 'number' && isFinite(data.y) ? roundN(clamp(data.y, 0.15, 0.92), 4) : 0.7;
      const vx = typeof data.vx === 'number' && isFinite(data.vx) ? roundN(clamp(data.vx, -1.5, 1.5), 3) : 0;
      const vy = typeof data.vy === 'number' && isFinite(data.vy) ? roundN(clamp(data.vy, -1.5, 1.5), 3) : 0;
      att.lastMsgAt = now;
      att.lastActive = now;
      ws.serializeAttachment(att);
      this.broadcast({ t: 'y', id: att.id, x, y, vx, vy }, ws);
    } else if (data.t === 'ping') {
      // Lightweight keepalive while user is active
      if (data.a === 1) {
        att.lastActive = now;
        ws.serializeAttachment(att);
      }
      try {
        ws.send('{"t":"pong"}');
      } catch (_) {}
    }
  }

  async webSocketClose(ws) {
    const att = ws.deserializeAttachment();
    if (att && att.id) {
      this.broadcast({ t: 'leave', id: att.id }, ws);
    }
  }

  async webSocketError(ws) {
    const att = ws.deserializeAttachment();
    try {
      ws.close(1011, 'socket error');
    } catch (_) {}
    if (att && att.id) {
      this.broadcast({ t: 'leave', id: att.id }, ws);
    }
  }

  async alarm() {
    const now = Date.now();
    const sockets = this.ctx.getWebSockets();
    let remaining = 0;

    for (const ws of sockets) {
      const att = ws.deserializeAttachment();
      if (!att || now - (att.lastActive || att.joinedAt || 0) >= IDLE_TIMEOUT_MS) {
        try {
          ws.close(4000, 'inactive');
        } catch (_) {}
        if (att && att.id) {
          this.broadcast({ t: 'leave', id: att.id }, ws);
        }
      } else {
        remaining++;
      }
    }

    // Only reschedule alarm while someone is connected (full zero-cost hibernation when empty!)
    if (remaining > 0) {
      await this.ctx.storage.setAlarm(Date.now() + SWEEP_INTERVAL_MS);
    }
  }
}
