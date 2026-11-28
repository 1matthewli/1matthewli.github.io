// Main loop: silent visual monochrome ASCII world, sustained-rub purring, auto-eat ceramic bowls, and Google Form messaging
(function () {
  'use strict';

  // Google Form endpoint for async visitor notes (Responses tab / linked Sheet, zero email needed)
  const GOOGLE_FORM_ACTION =
    'https://docs.google.com/forms/d/e/1FAIpQLSfb21BjquoLg2smO6K_Eaei-HGoPrZZvikIjnIP4K_WAm2NZw/formResponse';
  const GOOGLE_FORM_FIELD = 'entry.1707674574';

  const canvas = document.getElementById('world-canvas');
  const namePlateEl = document.getElementById('name-plate');
  const hintEl = document.getElementById('hint');
  const msgToggleEl = document.getElementById('msg-toggle');
  const msgPanelEl = document.getElementById('message-panel');
  const msgDisplayEl = document.getElementById('msg-display');
  const msgPlaceholderEl = document.getElementById('msg-placeholder');
  const msgStatusEl = document.getElementById('msg-status');
  const notesListEl = document.getElementById('notes-list');
  const msgSendEl = document.getElementById('msg-send');
  const msgCloseEl = document.getElementById('msg-close');
  const mobileInputEl = document.getElementById('mobile-type-input');
  const presenceEl = document.getElementById('presence-pill');

  const room = new window.AsciiRoom();
  const renderer = new window.AsciiRenderer(canvas);
  room.syncLayout(renderer.cols, renderer.rows, true);

  function updatePresenceUI(status) {
    if (!presenceEl) return;
    if (status && status.connected && status.remoteCount > 0) {
      const total = status.remoteCount + 1;
      presenceEl.textContent = `${total} cats here`;
      presenceEl.classList.remove('hidden');
    } else {
      presenceEl.classList.add('hidden');
    }
  }

  const multiplayer = window.CatMultiplayer
    ? new window.CatMultiplayer(room, updatePresenceUI)
    : null;

  room.onYarnBat = (x, y, vx, vy) => {
    if (multiplayer) multiplayer.sendYarnImpulse(x, y, vx, vy);
  };
  room.onRemoteCatsChange = () => {
    if (multiplayer) multiplayer.notifyStatus();
  };

  const keys = new Set();
  let pointerDown = false;
  let hintQuieted = false;
  let fps = 60;
  let lastTime = performance.now();
  let lastGlowStr = '';
  let lastPtrX = null;
  let lastPtrY = null;
  let statusTimeout = null;

  function isTouchDevice() {
    return window.innerWidth <= 640 || window.matchMedia('(pointer: coarse)').matches;
  }

  function formatNoteTime(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }

  function renderNotesList() {
    const msgs = room.savedMessages;
    if (msgToggleEl) {
      if (room.typingMode) {
        msgToggleEl.textContent = 'close keyboard [esc]';
      } else {
        msgToggleEl.textContent = msgs.length > 0 ? `leave a message (${msgs.length})` : 'leave a message';
      }
    }

    if (!notesListEl) return;
    notesListEl.textContent = '';
    if (msgs.length === 0) {
      notesListEl.classList.add('hidden');
      return;
    }

    notesListEl.classList.remove('hidden');
    const heading = document.createElement('div');
    heading.className = 'notes-heading';
    heading.textContent = `notes left here (${msgs.length})`;
    notesListEl.appendChild(heading);

    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const row = document.createElement('div');
      row.className = 'note-item';

      const textSpan = document.createElement('span');
      textSpan.className = 'note-item-text';
      textSpan.textContent = m.text;

      const timeSpan = document.createElement('span');
      timeSpan.className = 'note-item-time';
      timeSpan.textContent = formatNoteTime(m.ts);

      row.appendChild(textSpan);
      row.appendChild(timeSpan);
      notesListEl.appendChild(row);
    }
  }

  function updateHintCopy() {
    if (room.typingMode) {
      hintEl.textContent = isTouchDevice()
        ? 'tap keys or type · enter to send · esc to close'
        : 'type on your keyboard or click keys · enter to send · esc to close';
      return;
    }
    hintEl.textContent = isTouchDevice()
      ? 'tap to wander · tap/rub cat'
      : 'wasd / arrows / click to wander · click cat to meow · rub to purr';
  }
  updateHintCopy();
  renderNotesList();

  function syncMessageDisplay() {
    const text = room.messageText;
    msgDisplayEl.textContent = text;
    if (text.length > 0) {
      msgPlaceholderEl.classList.add('hidden');
    } else {
      msgPlaceholderEl.classList.remove('hidden');
    }
  }

  function showStatus(msg) {
    msgStatusEl.textContent = msg;
    if (statusTimeout) clearTimeout(statusTimeout);
    if (msg) {
      statusTimeout = setTimeout(() => {
        msgStatusEl.textContent = '';
      }, 3200);
    }
  }

  const msgLineEl = document.getElementById('msg-line');
  let closeAfterSendTimeout = null;

  function syncVisualViewport() {
    if (window.visualViewport && window.innerHeight > 0) {
      room.setVisibleRatio(window.visualViewport.height / window.innerHeight);
    }
  }

  function focusMobileInput() {
    if (!mobileInputEl) return;
    mobileInputEl.value = '';
    try {
      mobileInputEl.focus({ preventScroll: true });
    } catch (_) {
      mobileInputEl.focus();
    }
  }

  function openTypingMode() {
    if (closeAfterSendTimeout) {
      clearTimeout(closeAfterSendTimeout);
      closeAfterSendTimeout = null;
    }
    keys.clear();
    pointerDown = false;
    const touch = isTouchDevice();
    document.body.classList.toggle('typing-mobile', touch);
    syncVisualViewport();
    room.enterTypingMode();
    msgPanelEl.classList.remove('hidden');
    syncMessageDisplay();
    renderNotesList();
    updateHintCopy();
    if (touch) {
      focusMobileInput();
    }
  }

  function closeTypingMode() {
    if (closeAfterSendTimeout) {
      clearTimeout(closeAfterSendTimeout);
      closeAfterSendTimeout = null;
    }
    room.exitTypingMode();
    document.body.classList.remove('typing-mobile');
    msgPanelEl.classList.add('hidden');
    if (mobileInputEl) mobileInputEl.blur();
    renderNotesList();
    updateHintCopy();
  }

  function handleSendMessage() {
    const entry = room.submitMessage();
    syncMessageDisplay();
    if (!entry) return;

    renderNotesList();
    showStatus('note sent');

    if (GOOGLE_FORM_ACTION && GOOGLE_FORM_FIELD) {
      const params = new URLSearchParams();
      params.append(GOOGLE_FORM_FIELD, entry.text);
      fetch(GOOGLE_FORM_ACTION, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: params.toString(),
      }).catch(() => {});
    }

    // Automatically close the typing prompt right after the cat's paw hits RET!
    if (closeAfterSendTimeout) clearTimeout(closeAfterSendTimeout);
    closeAfterSendTimeout = setTimeout(() => {
      closeAfterSendTimeout = null;
      closeTypingMode();
    }, 280);
  }

  function handleTypedKey(rawKey) {
    if (rawKey === 'Enter' || rawKey === 'ENTER') {
      handleSendMessage();
      return;
    }
    const res = room.typeKey(rawKey);
    if (res) {
      syncMessageDisplay();
    }
  }

  if (msgLineEl) {
    msgLineEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (room.typingMode) {
        focusMobileInput();
      }
    });
  }

  if (msgToggleEl) {
    msgToggleEl.addEventListener('click', (e) => {
      e.stopPropagation();
      msgToggleEl.blur();
      if (room.typingMode) {
        closeTypingMode();
      } else {
        openTypingMode();
      }
    });
  }

  msgSendEl.addEventListener('click', (e) => {
    e.stopPropagation();
    handleSendMessage();
  });

  msgCloseEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTypingMode();
  });

  if (mobileInputEl) {
    mobileInputEl.addEventListener('input', () => {
      if (!room.typingMode) return;
      const val = mobileInputEl.value;
      mobileInputEl.value = '';
      for (let i = 0; i < val.length; i++) {
        handleTypedKey(val[i]);
      }
    });
    mobileInputEl.addEventListener('keydown', (e) => {
      if (!room.typingMode) return;
      if (e.key === 'Backspace' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        if (e.key === 'Escape') {
          closeTypingMode();
        } else {
          handleTypedKey(e.key);
        }
      }
    });
  }

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      syncVisualViewport();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (multiplayer) multiplayer.markActive();
    if (e.target === mobileInputEl) return;

    if (room.typingMode) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        closeTypingMode();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSendMessage();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleTypedKey('Backspace');
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        handleTypedKey(e.key);
        return;
      }
      return;
    }

    const code = e.code;
    if (
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight' ||
      code === 'Space'
    ) {
      e.preventDefault();
    }

    if (code === 'KeyM' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (!e.repeat) {
        e.preventDefault();
        openTypingMode();
      }
      return;
    }

    if (code === 'Space') {
      if (!e.repeat) {
        room.meow();
      }
      return;
    }

    keys.add(code);
  });

  window.addEventListener('keyup', (e) => {
    keys.delete(e.code);
  });

  window.addEventListener('blur', () => {
    keys.clear();
    pointerDown = false;
    lastPtrX = null;
    lastPtrY = null;
  });

  function setTarget(clientX, clientY) {
    const pos = renderer.screenToRoom(clientX, clientY);
    if (room.isPointOnPond(pos.x, pos.y)) {
      room.walkToPond(pos.x, pos.y);
      return;
    }
    const clamped = room.clampToRoom(pos.x, pos.y);
    room.leaveBox(2.8);
    room.cat.targetBowlId = null;
    room.cat.targetBox = false;
    room.cat.targetPond = false;
    room.cat.autoTargetX = null;
    room.cat.autoTargetY = null;
    room.cat.targetX = clamped.x;
    room.cat.targetY = clamped.y;
    room.cat.wanderTimer = 5.0;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (multiplayer) multiplayer.markActive();
    const pos = renderer.screenToRoom(e.clientX, e.clientY);
    lastPtrX = pos.x;
    lastPtrY = pos.y;

    // In typing mode: clicking/tapping directly on an ASCII key strikes it with the cat's paw
    if (room.typingMode) {
      const clickedKey = room.findKeyAt(pos.x, pos.y);
      if (clickedKey) {
        if (clickedKey.id === 'BACKSPACE') {
          handleTypedKey('Backspace');
        } else if (clickedKey.id === 'ENTER') {
          handleSendMessage();
        } else {
          handleTypedKey(clickedKey.id.length === 1 ? clickedKey.id.toLowerCase() : clickedKey.id);
        }
        return;
      }
      if (room.isPointOnCat(pos.x, pos.y)) {
        room.meow();
        return;
      }
      if (isTouchDevice() && mobileInputEl) {
        mobileInputEl.focus();
      }
      return;
    }

    // 1. Clicking/tapping a food bowl ALWAYS eats/walks to eat it — even when close to a big cat!
    const clickedBowl = room.findBowlAt(pos.x, pos.y);
    if (clickedBowl) {
      const reach = room.getEatReach();
      if (!room.cat.inBox && Math.hypot(clickedBowl.x - room.cat.x, (clickedBowl.y - (room.cat.y - 2)) * 1.6) < reach) {
        room.eatBowl(clickedBowl);
        room.cat.targetBowlId = null;
        room.cat.targetPond = false;
        room.cat.targetX = null;
        room.cat.targetY = null;
      } else {
        room.leaveBox(2.8);
        room.cat.autoTargetX = null;
        room.cat.autoTargetY = null;
        room.cat.targetBox = false;
        room.cat.targetPond = false;
        room.cat.targetBowlId = clickedBowl.id;
        room.cat.targetX = clickedBowl.x;
        room.cat.targetY = clickedBowl.y;
      }
      pointerDown = false;
      return;
    }

    // 2. Clicking/tapping the yarn ball walks the cat over so the cat bats it!
    if (room.isPointOnYarn(pos.x, pos.y)) {
      room.leaveBox(2.8);
      room.cat.targetBowlId = null;
      room.cat.targetBox = false;
      room.cat.targetPond = false;
      room.cat.autoTargetX = null;
      room.cat.autoTargetY = null;
      room.cat.targetX = room.yarn.x;
      room.cat.targetY = room.yarn.y;
      pointerDown = false;
      return;
    }

    // 3. Clicking/tapping the empty cardboard box walks the cat over to hop inside!
    if (room.isPointOnBox(pos.x, pos.y) && !room.cat.inBox) {
      room.walkToBox();
      pointerDown = false;
      return;
    }

    // 4. Clicking/tapping anywhere else on the cat ALWAYS meows (ASCII text) & stays put!
    if (room.isPointOnCat(pos.x, pos.y)) {
      const c = room.cat;
      c.vx = 0;
      c.vy = 0;
      c.targetX = null;
      c.targetY = null;
      c.targetBowlId = null;
      c.targetBox = false;
      c.targetPond = false;
      c.autoTargetX = null;
      c.autoTargetY = null;
      c.wanderTimer = 3.2;
      room.meow();
      pointerDown = false;
      return;
    }

    // 5. Clicking/tapping the pond ripples the water AND walks the cat over to the pond bank!
    if (room.isPointOnPond(pos.x, pos.y)) {
      room.walkToPond(pos.x, pos.y);
      pointerDown = false;
      return;
    }

    pointerDown = true;
    setTarget(e.clientX, e.clientY);
  });

  canvas.addEventListener('pointermove', (e) => {
    const pos = renderer.screenToRoom(e.clientX, e.clientY);
    const moveDist = lastPtrX !== null ? Math.hypot(pos.x - lastPtrX, (pos.y - lastPtrY) * 1.6) : 0;
    lastPtrX = pos.x;
    lastPtrY = pos.y;

    // Rubbing the mouse over the stationary cat for ~2s makes it purr (skip while dragging to walk!)
    if (!pointerDown && moveDist > 0.22 && room.petAt(pos.x, pos.y, moveDist)) {
      canvas.style.cursor = 'grab';
    } else if (!pointerDown) {
      canvas.style.cursor = 'pointer';
    }

    if (!pointerDown || room.typingMode) return;
    setTarget(e.clientX, e.clientY);
  });

  window.addEventListener('pointerup', () => {
    pointerDown = false;
  });

  window.addEventListener('resize', () => {
    renderer.resize();
    room.syncLayout(renderer.cols, renderer.rows, false);
    syncVisualViewport();
    updateHintCopy();
  });

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      renderer.bakeAtlas();
    });
  }

  function sampleInput() {
    if (room.typingMode) return { moveX: 0, moveY: 0, sprint: false };
    let moveX = 0;
    let moveY = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) moveY -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) moveY += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) moveX -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) moveX += 1;
    const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
    return { moveX, moveY, sprint };
  }

  window.__ASCII_ROOM__ = {
    getState: () => ({
      cat: {
        x: Number(room.cat.x.toFixed(2)),
        y: Number(room.cat.y.toFixed(2)),
        pose: room.cat.pose,
        inBox: room.cat.inBox,
        inPond: room.cat.inPond,
        wetness: Number(room.cat.wetness.toFixed(2)),
        shaking: room.cat.shakeTimer > 0,
        inSunbeam: room.isInSunbeam(room.cat.x, room.cat.y),
        meowing: room.cat.meowTimer > 0,
        petStreak: Number(room.cat.petStreak.toFixed(2)),
        purrLevel: Number(room.cat.purrLevel.toFixed(2)),
        bowlsEaten: room.cat.bowlsEaten,
        scale: Number(room.cat.scale.toFixed(2)),
        autoWandering: room.cat.autoTargetX !== null,
      },
      box: { x: room.box.x, y: room.box.y },
      pond: { x: room.pond.x, y: room.pond.y, ripples: room.pondRipples.length },
      sunbeam: { x: room.sunbeam.x, y: room.sunbeam.y },
      weather: { isNight: room.weather.isNight, rainIntensity: Number(room.weather.rainIntensity.toFixed(2)) },
      yarn: { x: Number(room.yarn.x.toFixed(1)), y: Number(room.yarn.y.toFixed(1)), vx: Number(room.yarn.vx.toFixed(1)) },
      moth: { active: room.moth.active, x: Number(room.moth.x.toFixed(1)), y: Number(room.moth.y.toFixed(1)) },
      typing: {
        active: room.typingMode,
        message: room.messageText,
        savedCount: room.savedMessages.length,
        keyboard: {
          left: room.keyboard.left,
          top: room.keyboard.top,
          width: room.keyboard.width,
          centerX: Number(room.keyboard.centerX.toFixed(1)),
        },
        leftPaw: { x: Number(room.typing.leftPaw.x.toFixed(1)), y: Number(room.typing.leftPaw.y.toFixed(1)) },
        rightPaw: { x: Number(room.typing.rightPaw.x.toFixed(1)), y: Number(room.typing.rightPaw.y.toFixed(1)) },
        activeKeys: Object.keys(room.typing.activeKeys),
      },
      bowls: room.bowls.map((b) => ({ id: b.id, x: Number(b.x.toFixed(1)), y: Number(b.y.toFixed(1)) })),
      multiplayer: {
        enabled: Boolean(multiplayer && multiplayer.isEnabled()),
        connected: Boolean(multiplayer && multiplayer.connected),
        idleDisconnected: Boolean(multiplayer && multiplayer.idleDisconnected),
        remoteCount: room.remoteCats.size,
      },
      grid: { cols: renderer.cols, rows: renderer.rows },
      webgl: Boolean(renderer.gl),
      fps: Math.round(fps),
    }),
    spawnBowlNow: () => room.spawnBowl(),
    setIdlePose: (p) => room.setIdlePose(p),
    setScaleForTest: (sc) => {
      room.cat.scale = sc;
      room.cat.targetScale = sc;
      room.cat.bowlsEaten = Math.max(0, Math.round((sc - 1.0) / 0.18));
    },
    setWeatherForTest: (isNight, raining) => {
      room.weather.isNight = Boolean(isNight);
      room.weather.raining = Boolean(raining);
      room.weather.rainIntensity = raining ? 1.0 : 0.0;
    },
    spawnMothNow: () => {
      room.moth.cooldown = 0;
    },
  };

  function frame(now) {
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    if (dt > 0 && dt < 0.25) {
      fps = fps * 0.92 + (1 / dt) * 0.08;
    }

    const input = sampleInput();
    room.update(dt, input);
    if (multiplayer) multiplayer.tick();
    renderer.render(room);

    if (namePlateEl) {
      const g = Math.max(0, Math.min(1, (room.nameAnchor.glow - 0.42) / 0.58)).toFixed(2);
      if (g !== lastGlowStr) {
        lastGlowStr = g;
        namePlateEl.style.setProperty('--glow', g);
      }
    }

    if (!hintQuieted && room.cat.totalMoved > 18) {
      hintQuieted = true;
      hintEl.classList.add('quiet');
    }

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
})();
