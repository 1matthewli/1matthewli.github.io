// High-detail singular non-scrolling monochrome ASCII room:
// Wind-swept meadow, two painterly trees, randomly spawning ceramic cat food bowls,
// an autonomous, pettable, continuously growing realistic ASCII cat, and on-the-spot keyboard typing
(function (global) {
  'use strict';

  const { clamp, lerp, hash2i } = global.AsciiMath;

  const MEOW_WORDS = ['meow', 'mew', 'mrrp', 'prrr~'];
  const EAT_WORDS = ['crunch!', 'nom nom', 'yum~', 'munch'];
  const GROW_WORDS = ['*bigger!*', 'fluffier~', 'chonk +1', 'big chonk', 'mega chonk', 'absolute unit', 'meadow titan', 'oh lawd'];
  const BOX_FIT_WORDS = ['if i fits...', 'cozy~', '*tucks in*'];
  const BOX_BIG_WORDS = ['*squish*', 'liquid cat', 'totally fits'];

  const STORAGE_KEY = 'matthew_ascii_messages_v1';

  // Canonical QWERTY keyboard grid geometry shared identically between
  // the ASCII keyboard renderer, paw strike IK targets, and pointer hit-testing
  function buildKeyboardLayout(cols, rows, anchorX, anchorY, visibleRatio) {
    const compact = cols < 110;
    const width = compact ? 36 : 50;
    const height = 11;
    const cx = typeof anchorX === 'number' ? anchorX : (cols - 1) * 0.5;
    const minLeft = 2;
    const maxLeft = Math.max(minLeft, cols - width - 2);
    const left = clamp(Math.round(cx - width * 0.5), minLeft, maxLeft);

    let top;
    if (compact) {
      // Position cleanly in the visible upper band ABOVE the iOS/mobile software keyboard
      // (composer sits at rows 1..10, cat sits right behind rows 14..top, keyboard occupies top..top+11)
      const visFrac = typeof visibleRatio === 'number' && visibleRatio < 0.85 ? visibleRatio : 0.56;
      const visibleRows = Math.round(rows * visFrac);
      const maxTop = Math.max(22, Math.min(Math.round(rows * 0.44), visibleRows - height - 2));
      top = clamp(maxTop, 22, Math.max(22, rows - height - 5));
    } else {
      const minTop = Math.round(rows * 0.48);
      const maxTop = Math.max(minTop, rows - height - 5);
      const rawTop = typeof anchorY === 'number' ? Math.round(anchorY) : Math.round(rows * 0.66);
      top = clamp(rawTop, minTop, maxTop);
    }

    const keys = [];
    const keyMap = {};
    const addKey = (id, label, dx, dy, w, hand) => {
      const k = {
        id,
        label,
        col: left + dx,
        row: top + dy,
        w,
        hand,
        centerX: left + dx + (w - 1) * 0.5,
        centerY: top + dy,
      };
      keys.push(k);
      keyMap[id] = k;
    };

    const leftSet = new Set(['1', '2', '3', '4', '5', 'Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B']);

    if (compact) {
      const r0 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
      r0.forEach((ch, i) => addKey(ch, ch, 1 + i * 3, 1, 3, leftSet.has(ch) ? 'left' : 'right'));
      addKey('BACKSPACE', '<', 31, 1, 4, 'right');

      const r1 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'];
      r1.forEach((ch, i) => addKey(ch, ch, 2 + i * 3, 3, 3, leftSet.has(ch) ? 'left' : 'right'));

      const r2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
      r2.forEach((ch, i) => addKey(ch, ch, 3 + i * 3, 5, 3, leftSet.has(ch) ? 'left' : 'right'));
      addKey('ENTER', '>', 30, 5, 4, 'right');

      const r3 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '?'];
      r3.forEach((ch, i) => addKey(ch, ch, 2 + i * 3, 7, 3, leftSet.has(ch) ? 'left' : 'right'));

      addKey(' ', 'SPACE', 9, 9, 18, 'either');
    } else {
      const r0 = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];
      r0.forEach((ch, i) => addKey(ch, ch, 2 + i * 4, 1, 3, leftSet.has(ch) ? 'left' : 'right'));
      addKey('BACKSPACE', '<-', 42, 1, 6, 'right');

      const r1 = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '!'];
      r1.forEach((ch, i) => addKey(ch, ch, 3 + i * 4, 3, 3, leftSet.has(ch) ? 'left' : 'right'));

      const r2 = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'];
      r2.forEach((ch, i) => addKey(ch, ch, 4 + i * 4, 5, 3, leftSet.has(ch) ? 'left' : 'right'));
      addKey('ENTER', 'RET', 40, 5, 7, 'right');

      const r3 = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '?'];
      r3.forEach((ch, i) => addKey(ch, ch, 5 + i * 4, 7, 3, leftSet.has(ch) ? 'left' : 'right'));

      addKey(' ', 'SPACE', 12, 9, 26, 'either');
    }

    const homeL = keyMap.F;
    const homeR = keyMap.J;
    return {
      compact,
      left,
      top,
      width,
      height,
      centerX: left + (width - 1) * 0.5,
      keys,
      keyMap,
      homeLeft: { x: homeL.centerX, y: top - 0.3 },
      homeRight: { x: homeR.centerX, y: top - 0.3 },
    };
  }

  class AsciiRoom {
    constructor() {
      this.time = 0;
      this.cols = 210;
      this.rows = 80;
      this.nextBowlId = 1;

      // Realistic sculpted ASCII cat (continuously grows up to giant meadow-titan scale!)
      this.cat = {
        x: 105,
        y: 52,
        vx: 0,
        vy: 0,
        speed: 0,
        pose: 'sit', // 'sit' | 'groom' | 'loaf' | 'sleep' | 'box' | 'right' | 'left' | 'up' | 'down'
        lastHoriz: 'right',
        idleTime: 2.0,
        stridePhase: 0,
        totalMoved: 0,

        // User-directed targets
        targetX: null,
        targetY: null,
        targetBowlId: null,
        targetBox: false,
        targetPond: false,
        inBox: false,
        boxCooldown: 0,

        // Pond wading & wet-cat state
        inPond: false,
        wetness: 0,
        shakeTimer: 0,
        pendingShake: false,
        pendingShakeTimer: 0,
        wetDripTimer: 0,
        pondStepRippleTimer: 0,

        // Autonomous gentle cat wandering & cozy idle lifecycle (sit -> groom / loaf -> sleep / box)
        autoTargetX: null,
        autoTargetY: null,
        wanderTimer: 3.5,
        idleStageTimer: 4.5,
        lastIdleAction: 'sit',
        groomTimer: 0,
        groomSide: 1,
        lookX: 0,
        lookTargetX: 0,
        lookTimer: 2.5,
        sleepZTimer: 0.6,

        // Smooth continuous growth (can become huge!)
        bowlsEaten: 0,
        scale: 1.0,
        targetScale: 1.0,
        growthPop: 0,

        // Petting & purring state (requires sustained rubbing before purring begins)
        petEnergy: 0,
        petStreak: 0,
        lastPetTime: -99,
        purrLevel: 0,
        purrSparkTimer: 0,

        // Expressive micro-animations
        blinkTimer: 2.4,
        blinkDuration: 0,
        earTwitchTimer: 4.0,
        earTwitchDuration: 0,
        earTwitchSide: 1,
        meowTimer: 0,
        meowText: 'meow',
        meowIndex: 0,
      };

      // Two painterly windswept trees framing the clearing
      this.trees = [
        { x: 38, y: 42, scale: 1.15, rustle: 0, seed: 17 },
        { x: 174, y: 60, scale: 1.0, rustle: 0, seed: 43 },
      ];

      // Minimalist open cardboard box tucked near the left clearing ("if I fits, I sits")
      this.box = {
        x: 52,
        y: 54,
        wiggle: 0,
      };

      // Warm diagonal sunbeam pool on the grass (cat gravitates here to loaf & nap!)
      this.sunbeam = {
        x: 142,
        y: 35,
        rx: 24,
        ry: 9,
      };

      // Physics ball of yarn with trailing monochrome thread
      this.yarn = {
        x: 144,
        y: 57,
        vx: 0,
        vy: 0,
        spin: 0,
        tail: [],
      };

      // Small still pond tucked serenely in the meadow
      this.pond = {
        x: 158,
        y: 62,
        rx: 16,
        ry: 4.5,
      };
      this.pondRipples = [];
      this.pondRippleTimer = 1.8;

      // Subtle time-of-day ambiance (local clock: night 19:00-05:59) + occasional gentle drizzle
      const hour = new Date().getHours();
      this.weather = {
        isNight: hour >= 19 || hour < 6,
        rainIntensity: 0,
        raining: false,
        rainTimer: 32 + Math.random() * 28,
      };
      this.fireflies = [];
      this.rainDrops = [];

      // Rare drifting meadow moth that floats across the clearing while the cat watches
      this.moth = {
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        phase: 0,
        age: 0,
        maxAge: 11,
        cooldown: 5.5,
        noticed: false,
      };

      // Anchor for the symmetric parted-grass clearing beneath MATTHEW LI + bio
      this.nameAnchor = {
        x: 104.5,
        y: 12,
        glow: 0.35,
      };

      // Randomly spawning single ceramic cat food bowl (strictly on-screen!)
      this.bowls = [];
      this.bowlSpawnTimer = 2.8;

      // Leave-a-message keyboard typing mode
      this.typingMode = false;
      this.typingBlend = 0;
      this.visibleRatio = 1.0;
      this.messageText = '';
      this.savedMessages = this.loadMessages();
      this.keyboard = buildKeyboardLayout(this.cols, this.rows);
      this.typing = {
        leftPaw: { x: this.keyboard.homeLeft.x, y: this.keyboard.homeLeft.y, strike: 0, hold: 0, tx: this.keyboard.homeLeft.x, ty: this.keyboard.homeLeft.y },
        rightPaw: { x: this.keyboard.homeRight.x, y: this.keyboard.homeRight.y, strike: 0, hold: 0, tx: this.keyboard.homeRight.x, ty: this.keyboard.homeRight.y },
        lastSpaceSide: 1,
        headBob: 0,
        lookX: 0,
        activeKeys: {},
      };

      // Callbacks wired by main.js
      this.onAutoEat = null;
      this.onYarnBat = null;
      this.lastYarnBatBroadcast = 0;

      // Live multiplayer remote visitor cats (id -> interpolated cat state)
      this.remoteCats = new Map();

      // Dynamic trails, ripples, leaves, crumbs, purr sparkles, sleep zZz
      this.trails = [];
      this.trailTimer = 0;
      this.ripples = [];
      this.leaves = [];
      this.crumbs = [];
      this.droplets = [];
      this.purrSparks = [];
      this.sleepZs = [];
      this.ambientLeafTimer = 1.6;
    }

    loadMessages() {
      try {
        const raw = global.localStorage && global.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(-30) : [];
      } catch (_) {
        return [];
      }
    }

    persistMessages() {
      try {
        if (global.localStorage) {
          global.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.savedMessages.slice(-30)));
        }
      } catch (_) {}
    }

    getBaseUnitScale() {
      return this.cols < 110 ? 0.72 : 1.0;
    }

    // Strict on-screen safe bounds so bowls never spawn off-screen or under header/bottom bar
    getSafeBowlBounds() {
      const cols = this.cols;
      const rows = this.rows;
      const compact = cols < 110;
      const minX = Math.max(compact ? 11 : 18, Math.round(cols * 0.12));
      const maxX = Math.min(cols - (compact ? 11 : 18), Math.round(cols * 0.88));
      const minY = Math.max(compact ? 24 : 22, Math.round(rows * 0.32));
      const maxY = Math.min(rows - (compact ? 13 : 11), Math.round(rows * 0.84));
      return {
        minX,
        maxX: Math.max(minX + 4, maxX),
        minY,
        maxY: Math.max(minY + 4, maxY),
      };
    }

    syncLayout(cols, rows, isInitial) {
      const prevCols = this.cols;
      const prevRows = this.rows;
      this.cols = cols;
      this.rows = rows;

      const compact = cols < 110;
      const u = this.getBaseUnitScale();

      if (compact) {
        this.trees[0].x = Math.round(cols * 0.16);
        this.trees[0].y = Math.round(rows * 0.37);
        this.trees[0].scale = 0.68;

        this.trees[1].x = Math.round(cols * 0.85);
        this.trees[1].y = Math.round(rows * 0.47);
        this.trees[1].scale = 0.64;

        this.box.x = Math.round(cols * 0.23);
        this.box.y = Math.round(rows * 0.69);

        this.sunbeam.x = Math.round(cols * 0.62);
        this.sunbeam.y = Math.round(rows * 0.35);
        this.sunbeam.rx = 16;
        this.sunbeam.ry = 7;

        this.pond.x = Math.round(cols * 0.73);
        this.pond.y = Math.round(rows * 0.79);
        this.pond.rx = 14.0;
        this.pond.ry = 4.3;
      } else {
        this.trees[0].x = Math.round(cols * 0.15);
        this.trees[0].y = Math.round(rows * 0.46);
        this.trees[0].scale = clamp(rows / 72, 0.88, 1.18);

        this.trees[1].x = Math.round(cols * 0.85);
        this.trees[1].y = Math.round(rows * 0.57);
        this.trees[1].scale = clamp(rows / 80, 0.82, 1.04);

        this.box.x = Math.round(cols * 0.23);
        this.box.y = Math.round(rows * 0.70);

        this.sunbeam.x = Math.round(cols * 0.66);
        this.sunbeam.y = Math.round(rows * 0.40);
        this.sunbeam.rx = 26;
        this.sunbeam.ry = 9.5;

        this.pond.x = Math.round(cols * 0.76);
        this.pond.y = Math.round(rows * 0.77);
        this.pond.rx = 20.5;
        this.pond.ry = 5.8;
      }

      // Exact mathematical horizontal & vertical symmetry matching CSS #name-plate
      this.nameAnchor.x = (cols - 1) * 0.5;
      this.nameAnchor.y = (rows - 1) * (compact ? 0.13 : 0.15);

      const bounds = this.getSafeBowlBounds();
      if (isInitial) {
        this.cat.x = (cols - 1) * 0.5;
        this.cat.y = rows * (compact ? 0.56 : 0.60);
        this.yarn.x = Math.round(cols * (compact ? 0.34 : 0.56));
        this.yarn.y = Math.round(rows * (compact ? 0.81 : 0.74));
        this.yarn.vx = 0;
        this.yarn.vy = 0;
        this.yarn.tail = [];
        for (let i = 1; i <= 7; i++) {
          this.yarn.tail.push({ x: this.yarn.x + i * 1.4 * u, y: this.yarn.y + Math.sin(i * 0.9) * 0.6 * u });
        }
        this.spawnBowl();
      } else {
        const rx = prevCols > 0 ? this.cat.x / prevCols : 0.5;
        const ry = prevRows > 0 ? this.cat.y / prevRows : 0.60;
        const pos = this.clampToRoom(rx * cols, ry * rows);
        this.cat.x = pos.x;
        this.cat.y = pos.y;
        this.cat.targetX = null;
        this.cat.targetY = null;
        this.cat.targetBowlId = null;
        this.cat.targetBox = false;
        this.cat.autoTargetX = null;
        this.cat.autoTargetY = null;
        if (this.cat.inBox) {
          this.cat.x = this.box.x;
          this.cat.y = this.box.y;
        }

        const yrx = prevCols > 0 ? this.yarn.x / prevCols : 0.56;
        const yry = prevRows > 0 ? this.yarn.y / prevRows : 0.74;
        this.yarn.x = clamp(yrx * cols, bounds.minX, bounds.maxX);
        this.yarn.y = clamp(yry * rows, bounds.minY, bounds.maxY);
        this.yarn.tail = [];
      }

      // Rebuild canonical QWERTY keyboard coordinates (above iOS keyboard on mobile!)
      this.keyboard = this.typingMode
        ? buildKeyboardLayout(cols, rows, this.cat.x, this.cat.y - 1.5, this.visibleRatio)
        : buildKeyboardLayout(cols, rows, undefined, undefined, this.visibleRatio);
      this.typing.leftPaw.tx = this.keyboard.homeLeft.x;
      this.typing.leftPaw.ty = this.keyboard.homeLeft.y;
      this.typing.rightPaw.tx = this.keyboard.homeRight.x;
      this.typing.rightPaw.ty = this.keyboard.homeRight.y;
      if (!this.typingMode) {
        this.typing.leftPaw.x = this.keyboard.homeLeft.x;
        this.typing.leftPaw.y = this.keyboard.homeLeft.y;
        this.typing.rightPaw.x = this.keyboard.homeRight.x;
        this.typing.rightPaw.y = this.keyboard.homeRight.y;
      } else {
        this.cat.x = this.keyboard.centerX;
        this.cat.y = this.keyboard.top + 1.5;
      }

      // Strictly keep all existing bowls inside the visible viewport on resize
      for (let i = 0; i < this.bowls.length; i++) {
        const b = this.bowls[i];
        b.x = clamp(b.x, bounds.minX, bounds.maxX);
        b.y = clamp(b.y, bounds.minY, bounds.maxY);
      }
    }

    setVisibleRatio(ratio) {
      const clamped = clamp(ratio, 0.36, 1.0);
      if (Math.abs(clamped - this.visibleRatio) < 0.015) return;
      this.visibleRatio = clamped;
      if (this.typingMode && this.cols < 110) {
        this.keyboard = buildKeyboardLayout(this.cols, this.rows, this.cat.x, this.cat.y - 1.5, this.visibleRatio);
        this.cat.x = this.keyboard.centerX;
        this.cat.y = this.keyboard.top + 1.5;
        this.typing.leftPaw.tx = this.keyboard.homeLeft.x;
        this.typing.leftPaw.ty = this.keyboard.homeLeft.y;
        this.typing.rightPaw.tx = this.keyboard.homeRight.x;
        this.typing.rightPaw.ty = this.keyboard.homeRight.y;
      }
    }

    spawnBowl() {
      if (this.bowls.length >= 1) return;
      const bounds = this.getSafeBowlBounds();
      const u = this.getBaseUnitScale();
      const catAvoid = Math.min(44 * u, 20 * u * this.cat.scale);

      let bestFallback = null;
      let bestFallbackDist = -1;

      for (let attempt = 0; attempt < 40; attempt++) {
        const bx = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
        const by = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);

        // Stay clear of both trees
        let nearTree = false;
        for (let i = 0; i < this.trees.length; i++) {
          const tr = this.trees[i];
          if (Math.hypot(bx - tr.x, (by - (tr.y - 6 * tr.scale)) * 1.4) < 21 * tr.scale) {
            nearTree = true;
            break;
          }
        }
        if (nearTree) continue;

        // Stay clear of the cardboard box and the pond
        if (Math.hypot(bx - this.box.x, (by - this.box.y) * 1.5) < 20 * u) continue;
        const pdx = (bx - this.pond.x) / (this.pond.rx + 8 * u);
        const pdy = (by - this.pond.y) / (this.pond.ry + 4 * u);
        if (pdx * pdx + pdy * pdy < 1.0) continue;

        const catDist = Math.hypot(bx - this.cat.x, (by - this.cat.y) * 1.6);
        if (catDist > bestFallbackDist) {
          bestFallbackDist = catDist;
          bestFallback = { x: bx, y: by };
        }
        if (catDist < catAvoid) continue;

        this.bowls.push({
          id: this.nextBowlId++,
          x: bx,
          y: by,
          phase: Math.random() * Math.PI * 2,
          age: 0,
        });
        return;
      }

      if (bestFallback) {
        this.bowls.push({
          id: this.nextBowlId++,
          x: bestFallback.x,
          y: bestFallback.y,
          phase: Math.random() * Math.PI * 2,
          age: 0,
        });
      }
    }

    getEatReach() {
      return Math.min(54 * this.getBaseUnitScale(), (16.5 + this.cat.scale * 4.5) * this.getBaseUnitScale());
    }

    findNearbyBowl(maxDist) {
      const c = this.cat;
      let best = null;
      let bestD = maxDist;
      for (let i = 0; i < this.bowls.length; i++) {
        const b = this.bowls[i];
        const d = Math.hypot(b.x - c.x, (b.y - (c.y - 2)) * 1.6);
        if (d < bestD) {
          bestD = d;
          best = b;
        }
      }
      return best;
    }

    findBowlAt(rx, ry) {
      const u = this.getBaseUnitScale();
      for (let i = 0; i < this.bowls.length; i++) {
        const b = this.bowls[i];
        if (Math.hypot(rx - b.x, (ry - (b.y - 1.2 * u)) * 1.6) < 11.0 * u) {
          return b;
        }
      }
      return null;
    }

    isInSunbeam(x, y) {
      const sb = this.sunbeam;
      const dx = (x - sb.x) / sb.rx;
      const dy = (y - sb.y) / sb.ry;
      return dx * dx + dy * dy <= 1.0;
    }

    isPointOnBox(rx, ry) {
      const u = this.getBaseUnitScale();
      return Math.abs(rx - this.box.x) <= 10.5 * u && Math.abs(ry - (this.box.y - 1.5 * u)) <= 5.5 * u;
    }

    isPointOnPond(rx, ry) {
      const p = this.pond;
      const dx = (rx - p.x) / p.rx;
      const dy = (ry - p.y) / p.ry;
      return dx * dx + dy * dy <= 1.05;
    }

    spawnPondRipple(rx, ry) {
      const p = this.pond;
      const x = typeof rx === 'number' ? rx : p.x + (Math.random() - 0.5) * p.rx * 1.1;
      const y = typeof ry === 'number' ? ry : p.y + (Math.random() - 0.5) * p.ry * 0.9;
      if (this.pondRipples.length > 8) this.pondRipples.shift();
      this.pondRipples.push({
        x,
        y,
        r: 0.4,
        maxR: Math.min(p.rx * 0.78, 5.5 + Math.random() * 4.0),
        age: 0,
        maxAge: 1.5 + Math.random() * 0.6,
      });
    }

    isPointOnYarn(rx, ry) {
      const u = this.getBaseUnitScale();
      return Math.hypot(rx - this.yarn.x, (ry - this.yarn.y) * 1.6) <= 6.2 * u;
    }

    batYarn(dirX, dirY, power) {
      const u = this.getBaseUnitScale();
      let bx = dirX;
      let by = dirY;
      // Gently steer away from walls/corners so the ball always stays happily in play
      const cx = this.cols * 0.5;
      const cy = this.rows * 0.56;
      const edgeX = this.cols * 0.20;
      const edgeY = this.rows * 0.22;
      if (this.yarn.x < edgeX || this.yarn.x > this.cols - edgeX) {
        bx += (cx - this.yarn.x) * 0.08;
      }
      if (this.yarn.y < this.rows * 0.30 || this.yarn.y > this.rows - edgeY) {
        by += (cy - this.yarn.y) * 0.08;
      }
      const len = Math.hypot(bx, by);
      const nx = len > 0.01 ? bx / len : (Math.random() > 0.5 ? 1 : -1);
      const ny = len > 0.01 ? by / len : (Math.random() - 0.5) * 0.6;
      const spd = (power || 34) * u;
      this.yarn.vx = nx * spd;
      this.yarn.vy = ny * spd * 0.62;
      if (this.onYarnBat && this.time - this.lastYarnBatBroadcast > 0.18) {
        this.lastYarnBatBroadcast = this.time;
        this.onYarnBat(this.yarn.x, this.yarn.y, this.yarn.vx, this.yarn.vy);
      }
    }

    applyRemoteYarn(nx, ny, nvx, nvy) {
      if (typeof nx !== 'number' || typeof ny !== 'number') return;
      const bounds = this.getSafeBowlBounds();
      this.yarn.x = clamp(nx * this.cols, bounds.minX, bounds.maxX);
      this.yarn.y = clamp(ny * this.rows, bounds.minY, bounds.maxY);
      this.yarn.vx = clamp((nvx || 0) * this.cols, -70, 70);
      this.yarn.vy = clamp((nvy || 0) * this.rows, -45, 45);
    }

    upsertRemoteCat(peer) {
      if (!peer || !peer.id) return;
      const id = String(peer.id).slice(0, 16);
      const validPoses = { sit: 1, right: 1, left: 1, up: 1, down: 1, loaf: 1, sleep: 1, groom: 1, box: 1 };
      const pose = typeof peer.p === 'string' && validPoses[peer.p] ? peer.p : 'sit';
      const flags = peer.b | 0;
      const inBox = (flags & 1) !== 0;
      const inPond = (flags & 2) !== 0;
      const shaking = (flags & 4) !== 0;
      const purring = (flags & 8) !== 0;
      const nx = clamp(typeof peer.x === 'number' && isFinite(peer.x) ? peer.x : 0.5, 0.02, 0.98);
      const ny = clamp(typeof peer.y === 'number' && isFinite(peer.y) ? peer.y : 0.6, 0.08, 0.96);
      const tx = inBox ? this.box.x : nx * this.cols;
      const ty = inBox ? this.box.y : ny * this.rows;
      const sc = clamp(typeof peer.sc === 'number' && isFinite(peer.sc) ? peer.sc : 1.0, 0.8, 6.5);
      const wet = clamp(typeof peer.w === 'number' && isFinite(peer.w) ? peer.w : 0, 0, 1);

      let rc = this.remoteCats.get(id);
      if (!rc) {
        if (this.remoteCats.size >= 36) return;
        rc = {
          id,
          seed: typeof peer.seed === 'number' && isFinite(peer.seed) ? peer.seed : hash2i(id.charCodeAt(0) || 1, this.remoteCats.size + 3) * 1000,
          nx,
          ny,
          x: tx,
          y: ty,
          targetX: tx,
          targetY: ty,
          speed: 0,
          pose,
          stridePhase: 0,
          scale: sc,
          targetScale: sc,
          bowlsEaten: Math.max(0, Math.round((sc - 1.0) / 0.18)),
          growthPop: 0,
          inBox,
          inPond,
          wetness: wet,
          shakeTimer: shaking ? 0.65 : 0,
          purrLevel: purring ? 0.9 : 0,
          blinkTimer: 1.5 + Math.random() * 3.0,
          blinkDuration: 0,
          earTwitchTimer: 2.5 + Math.random() * 4.0,
          earTwitchDuration: 0,
          earTwitchSide: 1,
          groomSide: 1,
          lookX: 0,
          meowTimer: 0,
          meowText: '',
          alpha: 0.05,
          lastUpdate: Date.now(),
        };
        this.remoteCats.set(id, rc);
      } else {
        rc.nx = nx;
        rc.ny = ny;
        rc.targetX = tx;
        rc.targetY = ty;
        rc.pose = pose;
        rc.targetScale = sc;
        rc.bowlsEaten = Math.max(0, Math.round((sc - 1.0) / 0.18));
        rc.inBox = inBox;
        rc.inPond = inPond;
        rc.wetness = wet;
        if (shaking) rc.shakeTimer = Math.max(rc.shakeTimer, 0.55);
        rc.purrLevel = purring ? 0.9 : 0;
        rc.lastUpdate = Date.now();
      }

      if (typeof peer.m === 'string' && peer.m.length > 0) {
        const cleanM = peer.m.slice(0, 18).replace(/[^\x20-\x7E]/g, '');
        if (cleanM) {
          rc.meowText = cleanM;
          rc.meowTimer = 1.65;
          if (inPond) {
            this.spawnPondRipple(rc.x, rc.y);
          }
        }
      }
    }

    removeRemoteCat(id) {
      this.remoteCats.delete(String(id));
    }

    clearRemoteCats() {
      this.remoteCats.clear();
    }

    spawnDroplet(x, y, vx, vy, ch) {
      if (this.droplets.length > 36) this.droplets.shift();
      this.droplets.push({
        x,
        y,
        vx,
        vy,
        life: 0,
        maxLife: 0.48 + Math.random() * 0.32,
        ch: ch || (Math.random() < 0.55 ? 39 : 46), // "'" or "."
      });
    }

    triggerWetShake() {
      const c = this.cat;
      const u = this.getBaseUnitScale();
      const s = Math.min(c.scale, 3.2) * u;
      c.shakeTimer = 0.68;
      c.pendingShake = false;
      c.wetness = Math.max(0.18, c.wetness * 0.35);
      c.meowTimer = 1.55;
      const shakeWords = ['*brrr!*', '*shake*', 'soggy~'];
      c.meowText = shakeWords[Math.floor(Math.random() * shakeWords.length)];

      // Fling bright monochrome water droplets outward from both flanks
      for (let i = 0; i < 14; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const spreadY = -1.5 - Math.random() * 7.5 * s;
        const ox = c.x + side * (4.2 + Math.random() * 2.5) * s;
        const oy = c.y + spreadY;
        const vx = side * (9.0 + Math.random() * 11.0) * u;
        const vy = (-5.5 - Math.random() * 4.5) * u;
        this.spawnDroplet(ox, oy, vx, vy, i % 3 === 0 ? 126 : i % 2 === 0 ? 39 : 46);
      }
    }

    walkToPond(rx, ry) {
      const c = this.cat;
      if (this.typingMode) return;
      this.spawnPondRipple(rx, ry);
      this.leaveBox(2.8);
      // Pull edge taps slightly inward so the cat always hops comfortably inside the pool
      const p = this.pond;
      const inX = p.x + (rx - p.x) * 0.65;
      const inY = p.y + (ry - p.y) * 0.55;
      const dest = this.clampToRoom(inX, inY);
      c.targetBowlId = null;
      c.targetBox = false;
      c.targetPond = true;
      c.autoTargetX = null;
      c.autoTargetY = null;
      c.targetX = dest.x;
      c.targetY = dest.y;
      c.wanderTimer = 5.0;
    }

    walkToBox() {
      const c = this.cat;
      if (this.typingMode) return;
      c.targetBowlId = null;
      c.targetPond = false;
      c.autoTargetX = null;
      c.autoTargetY = null;
      c.targetBox = true;
      c.targetX = this.box.x;
      c.targetY = this.box.y;
      c.boxCooldown = 0;
    }

    enterBox() {
      const c = this.cat;
      c.inBox = true;
      c.targetBox = false;
      c.targetX = null;
      c.targetY = null;
      c.autoTargetX = null;
      c.autoTargetY = null;
      c.vx = 0;
      c.vy = 0;
      c.speed = 0;
      c.x = this.box.x;
      c.y = this.box.y;
      c.pose = 'box';
      c.idleStageTimer = 10.0 + Math.random() * 6.0;
      this.box.wiggle = 1.0;
      c.meowTimer = 1.75;
      if (c.scale > 2.15) {
        const crushWords = ['*crushed it*', 'still my box', 'flat box~'];
        c.meowText = crushWords[Math.floor(Math.random() * crushWords.length)];
      } else if (c.scale > 1.45) {
        c.meowText = BOX_BIG_WORDS[Math.floor(Math.random() * BOX_BIG_WORDS.length)];
      } else {
        c.meowText = BOX_FIT_WORDS[Math.floor(Math.random() * BOX_FIT_WORDS.length)];
      }
    }

    leaveBox(cooldown) {
      const c = this.cat;
      if (!c.inBox && c.pose !== 'box') return;
      c.inBox = false;
      c.boxCooldown = Math.max(c.boxCooldown, cooldown || 2.8);
      this.box.wiggle = 0.75;
      if (c.pose === 'box') {
        c.pose = 'sit';
      }
    }

    eatBowl(bowl) {
      const idx = this.bowls.indexOf(bowl);
      if (idx === -1) return false;
      this.bowls.splice(idx, 1);

      const c = this.cat;
      c.bowlsEaten++;
      const maxScale = this.cols < 110 ? 4.5 : 6.5;
      const prevTarget = c.targetScale;
      c.targetScale = Math.min(maxScale, 1.0 + c.bowlsEaten * 0.18);
      const grew = c.targetScale > prevTarget + 0.001;

      c.meowTimer = 1.85;
      c.growthPop = 1.0;
      if (grew) {
        const tier = Math.min(GROW_WORDS.length - 1, Math.floor((c.bowlsEaten - 1) / 3));
        c.meowText = c.bowlsEaten % 2 === 1 ? GROW_WORDS[tier] : EAT_WORDS[c.bowlsEaten % EAT_WORDS.length];
      } else {
        c.meowText = EAT_WORDS[c.bowlsEaten % EAT_WORDS.length];
      }

      const u = this.getBaseUnitScale();
      this.ripples.push({
        x: bowl.x,
        y: bowl.y,
        radius: 2.5 * u,
        maxRadius: Math.min(64 * u, (28 + c.scale * 7) * u),
        speed: 34 * u,
      });

      const crumbCount = 10;
      for (let k = 0; k < crumbCount; k++) {
        const ang = (k / crumbCount) * Math.PI * 2 + Math.random() * 0.5;
        const spd = (5.0 + Math.random() * 6.5) * u;
        this.crumbs.push({
          x: bowl.x,
          y: bowl.y - 0.5,
          vx: Math.cos(ang) * spd,
          vy: Math.sin(ang) * spd * 0.62 - 2.4 * u,
          life: 0,
          maxLife: 0.72 + Math.random() * 0.35,
          ch: k % 2 === 0 ? 111 : 46, // 'o' and '.' kibble crumbs
        });
      }

      const clamped = this.clampToRoom(c.x, c.y);
      c.x = clamped.x;
      c.y = clamped.y;

      this.bowlSpawnTimer = Math.min(this.bowlSpawnTimer, 3.0 + Math.random() * 2.5);
      return true;
    }

    interact() {
      const nearby = this.findNearbyBowl(this.getEatReach());
      if (nearby) {
        this.eatBowl(nearby);
        return 'eat';
      }
      this.meow();
      return 'meow';
    }

    // Generous pose-aware hit box covering head, ears, belly, paws, and tail
    // so clicking anywhere on the cat ALWAYS meows and NEVER makes it walk!
    isPointOnCat(rx, ry) {
      const c = this.cat;
      const baseMult = this.cols < 110 ? 1.14 : this.getBaseUnitScale() * 1.12;
      const s = c.scale * baseMult;
      if (c.pose === 'right' || c.pose === 'left') {
        return (
          rx >= c.x - 16 * s &&
          rx <= c.x + 16 * s &&
          ry >= c.y - 12.0 * s &&
          ry <= c.y + 2.5 * s
        );
      }
      if (c.pose === 'loaf' || c.pose === 'sleep') {
        return (
          rx >= c.x - 12.5 * s &&
          rx <= c.x + 12.5 * s &&
          ry >= c.y - 9.5 * s &&
          ry <= c.y + 2.5 * s
        );
      }
      if (c.pose === 'box') {
        return (
          rx >= c.x - Math.max(9.5, 9.5 * s) &&
          rx <= c.x + Math.max(9.5, 9.5 * s) &&
          ry >= c.y - Math.max(10.0, 12.0 * s) &&
          ry <= c.y + 3.0
        );
      }
      return (
        rx >= c.x - 9.5 * s &&
        rx <= c.x + 11.5 * s &&
        ry >= c.y - 14.0 * s &&
        ry <= c.y + 2.5 * s
      );
    }

    setIdlePose(pose) {
      const c = this.cat;
      c.vx = 0;
      c.vy = 0;
      c.speed = 0;
      c.targetX = null;
      c.targetY = null;
      c.targetBowlId = null;
      c.targetBox = false;
      c.autoTargetX = null;
      c.autoTargetY = null;
      c.inBox = pose === 'box';
      if (c.inBox) {
        c.x = this.box.x;
        c.y = this.box.y;
      }
      c.pose = pose;
      c.idleTime = Math.max(c.idleTime, 2.0);
      if (pose === 'groom') {
        c.groomTimer = 2.6;
        c.groomSide = Math.random() > 0.5 ? 1 : -1;
      } else if (pose === 'loaf') {
        c.idleStageTimer = 7.0;
      } else if (pose === 'sleep') {
        c.idleStageTimer = 14.0;
        c.sleepZTimer = 0.2;
      } else if (pose === 'box') {
        c.idleStageTimer = 12.0;
      } else {
        c.idleStageTimer = 4.5;
      }
    }

    petAt(rx, ry, moveDist) {
      if (!this.isPointOnCat(rx, ry)) return false;
      const c = this.cat;
      // Don't treat cursor overlap while the cat is walking as petting
      if (c.speed > 4.0 || c.targetX !== null || c.targetBowlId !== null) return false;
      if (moveDist > 0.22) {
        c.lastPetTime = this.time;
        const boost = clamp(moveDist * 0.04, 0.01, 0.09);
        c.petEnergy = clamp(c.petEnergy + boost, 0, 1.0);
        // Only pause autonomous wander once the user is intentionally rubbing
        if (c.petStreak > 0.5) {
          c.autoTargetX = null;
          c.autoTargetY = null;
          c.wanderTimer = Math.max(c.wanderTimer, 4.0);
        }
      }
      return true;
    }

    enterTypingMode() {
      if (this.typingMode) return;
      this.typingMode = true;
      const c = this.cat;
      c.targetX = null;
      c.targetY = null;
      c.targetBowlId = null;
      c.targetBox = false;
      c.inBox = false;
      c.autoTargetX = null;
      c.autoTargetY = null;
      c.vx = 0;
      c.vy = 0;
      c.pose = 'sit';
      // Open the ASCII keyboard directly in front of the cat (or above iOS keyboard on mobile!)
      this.keyboard = buildKeyboardLayout(this.cols, this.rows, c.x, c.y - 1.5, this.visibleRatio);
      this.typing.leftPaw.x = this.keyboard.homeLeft.x;
      this.typing.leftPaw.y = this.keyboard.homeLeft.y;
      this.typing.leftPaw.tx = this.keyboard.homeLeft.x;
      this.typing.leftPaw.ty = this.keyboard.homeLeft.y;
      this.typing.leftPaw.strike = 0;
      this.typing.leftPaw.hold = 0;
      this.typing.rightPaw.x = this.keyboard.homeRight.x;
      this.typing.rightPaw.y = this.keyboard.homeRight.y;
      this.typing.rightPaw.tx = this.keyboard.homeRight.x;
      this.typing.rightPaw.ty = this.keyboard.homeRight.y;
      this.typing.rightPaw.strike = 0;
      this.typing.rightPaw.hold = 0;
    }

    exitTypingMode() {
      if (!this.typingMode) return;
      this.typingMode = false;
      this.typing.activeKeys = {};
      this.cat.idleStageTimer = 4.5;
    }

    findKeyAt(rx, ry) {
      if (!this.typingMode) return null;
      const keys = this.keyboard.keys;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (rx >= k.col - 0.5 && rx <= k.col + k.w - 0.5 && Math.abs(ry - k.row) <= 0.85) {
          return k;
        }
      }
      return null;
    }

    // Strike the EXACT key on the ASCII keyboard with the matching left/right cat paw (unobstructed view!)
    typeKey(rawKey) {
      if (!this.typingMode) return null;

      let keyId = '';
      let appendChar = '';
      let kind = 'char';

      if (rawKey === 'Backspace' || rawKey === 'BACKSPACE') {
        keyId = 'BACKSPACE';
        kind = 'backspace';
        if (this.messageText.length > 0) {
          this.messageText = this.messageText.slice(0, -1);
        }
      } else if (rawKey === 'Enter' || rawKey === 'ENTER') {
        keyId = 'ENTER';
        kind = 'enter';
      } else if (rawKey === ' ') {
        keyId = ' ';
        appendChar = ' ';
        kind = 'space';
      } else if (typeof rawKey === 'string' && rawKey.length === 1) {
        const upper = rawKey.toUpperCase();
        if (this.keyboard.keyMap[upper]) {
          keyId = upper;
          appendChar = rawKey;
        } else if (rawKey >= ' ' && rawKey <= '~') {
          keyId = rawKey === '!' && this.keyboard.keyMap['!'] ? '!' : (this.keyboard.keyMap['.'] ? '.' : ' ');
          appendChar = rawKey;
        } else {
          return null;
        }
      } else {
        return null;
      }

      if (appendChar && this.messageText.length < 140) {
        this.messageText += appendChar;
      }

      const keyObj = this.keyboard.keyMap[keyId] || this.keyboard.keyMap[' '];
      if (!keyObj) return { kind, keyObj: null };

      let useLeft = keyObj.hand === 'left';
      let strikeX = keyObj.centerX;
      const strikeY = keyObj.centerY;

      if (keyObj.hand === 'either') {
        this.typing.lastSpaceSide = -this.typing.lastSpaceSide;
        useLeft = this.typing.lastSpaceSide < 0;
        strikeX = keyObj.centerX + (useLeft ? -3.0 : 3.0);
      }

      const paw = useLeft ? this.typing.leftPaw : this.typing.rightPaw;
      paw.tx = strikeX;
      paw.ty = strikeY;
      paw.x = strikeX;
      paw.y = strikeY;
      paw.strike = 1.0;
      paw.hold = 0.44;

      this.typing.headBob = 1.0;
      this.typing.lookX = clamp((strikeX - this.keyboard.centerX) / (this.keyboard.width * 0.45), -1, 1);
      this.typing.activeKeys[keyObj.id] = 0.44;

      return { kind, keyObj, hand: useLeft ? 'left' : 'right' };
    }

    submitMessage() {
      const trimmed = this.messageText.trim();
      if (!trimmed) return null;
      this.typeKey('Enter');
      const entry = {
        text: trimmed,
        ts: Date.now(),
      };
      this.savedMessages.push(entry);
      this.persistMessages();
      this.messageText = '';
      this.cat.meowTimer = 1.8;
      this.cat.meowText = 'sent! ~';
      return entry;
    }

    pickAutonomousWanderTarget() {
      const bounds = this.getSafeBowlBounds();
      const c = this.cat;
      const u = this.getBaseUnitScale();
      const roll = Math.random();

      // 35% chance: gravitate toward the warm sunbeam patch for a cozy nap!
      if (roll < 0.35 && !this.isInSunbeam(c.x, c.y)) {
        const tx = clamp(this.sunbeam.x + (Math.random() - 0.5) * this.sunbeam.rx * 0.9, bounds.minX, bounds.maxX);
        const ty = clamp(this.sunbeam.y + (Math.random() - 0.5) * this.sunbeam.ry * 0.8, bounds.minY, bounds.maxY);
        const pos = this.clampToRoom(tx, ty);
        c.autoTargetX = pos.x;
        c.autoTargetY = pos.y;
        return;
      }

      // 16% chance: wander over to hop into the cardboard box ("if I fits, I sits")!
      if (roll < 0.51 && !c.inBox && c.boxCooldown <= 0) {
        c.autoTargetX = this.box.x;
        c.autoTargetY = this.box.y;
        return;
      }

      for (let attempt = 0; attempt < 16; attempt++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = (18 + Math.random() * 34) * u;
        const tx = clamp(c.x + Math.cos(ang) * dist, bounds.minX, bounds.maxX);
        const ty = clamp(c.y + Math.sin(ang) * dist * 0.65, bounds.minY, bounds.maxY);

        // Don't wander directly onto tree trunks
        let hitTree = false;
        for (let i = 0; i < this.trees.length; i++) {
          if (Math.hypot(tx - this.trees[i].x, (ty - this.trees[i].y) * 1.5) < 14 * this.trees[i].scale) {
            hitTree = true;
            break;
          }
        }
        if (hitTree) continue;

        const pos = this.clampToRoom(tx, ty);
        c.autoTargetX = pos.x;
        c.autoTargetY = pos.y;
        return;
      }
    }

    spawnLeaf(x, y, vx, vy) {
      if (this.leaves.length > 48) return;
      const u = this.getBaseUnitScale();
      this.leaves.push({
        x,
        y,
        vx: (vx || 0) + (3.2 + Math.random() * 3.8) * u,
        vy: (vy || 0) + (1.0 + Math.random() * 1.4) * u,
        phase: Math.random() * Math.PI * 2,
        life: 0,
        maxLife: 3.4 + Math.random() * 2.4,
      });
    }

    meow() {
      const c = this.cat;
      const u = this.getBaseUnitScale();
      c.meowTimer = 1.65;
      c.meowText = MEOW_WORDS[c.meowIndex % MEOW_WORDS.length];
      c.meowIndex++;

      this.ripples.push({
        x: c.x,
        y: c.y - 2.5 * u,
        radius: 2.5 * u,
        maxRadius: Math.min(60 * u, (30 + c.scale * 6) * u),
        speed: 34 * u,
      });

      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        if (Math.hypot(t.x - c.x, t.y - c.y) < 46 * u) {
          t.rustle = 0.9;
          for (let k = 0; k < 4; k++) {
            this.spawnLeaf(t.x + (Math.random() - 0.5) * 14 * t.scale, t.y - 12 * t.scale, 2.0, 0);
          }
        }
      }
    }

    clampToRoom(nx, ny) {
      const u = this.getBaseUnitScale();
      const s = this.cat.scale * u;
      // Cap wall margins so even a colossal 6x cat can roam freely and never gets pushed off the cardboard box!
      const marginX = Math.min(11 * s, this.cols * 0.14);
      const marginTop = Math.min(11 * s, this.rows * 0.24);
      const marginBot = 6.5;
      let x = clamp(nx, marginX, Math.max(marginX, this.cols - 1 - marginX));
      let y = clamp(ny, marginTop, Math.max(marginTop, this.rows - 1 - marginBot));

      const catR = Math.min(3.6 * s, 9.0 * u);
      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        const dx = x - t.x;
        const dy = (y - t.y) * 1.65;
        const dist = Math.hypot(dx, dy);
        const minD = catR + 3.2 * t.scale;
        if (dist < minD && dist > 0.001) {
          x = t.x + (dx / dist) * minD;
          y = t.y + ((dy / dist) * minD) / 1.65;
        }
      }

      return { x, y };
    }

    update(dt, input) {
      const clampedDt = Math.min(dt, 0.05);
      this.time += clampedDt;
      const c = this.cat;
      const u = this.getBaseUnitScale();

      // Smooth spring-like continuous cat growth animation
      c.scale = lerp(c.scale, c.targetScale, 1 - Math.exp(-7.5 * clampedDt));

      // Smooth typing mode blend
      const targetBlend = this.typingMode ? 1 : 0;
      this.typingBlend = lerp(this.typingBlend, targetBlend, 1 - Math.exp(-10 * clampedDt));
      if (Math.abs(this.typingBlend - targetBlend) < 0.005) this.typingBlend = targetBlend;

      // Update petting / purring level (requires ~2s of sustained rubbing while cat is stationary)
      c.petEnergy = Math.max(0, c.petEnergy - clampedDt * 0.65);
      const isStationary = c.speed <= 4.0 && c.targetX === null && c.targetBowlId === null;
      const isActivelyRubbing = isStationary && (this.time - c.lastPetTime) < 0.30 && c.petEnergy > 0.04;

      if (isActivelyRubbing) {
        c.petStreak = Math.min(2.9, c.petStreak + clampedDt);
      } else {
        const decayRate = isStationary ? 2.2 : 5.5;
        c.petStreak = Math.max(0, c.petStreak - clampedDt * decayRate);
      }

      const PURR_THRESHOLD_SEC = 2.0;
      const targetPurr = isStationary && c.petStreak >= PURR_THRESHOLD_SEC
        ? clamp((c.petStreak - PURR_THRESHOLD_SEC) / 0.85, 0, 1)
        : 0;
      c.purrLevel = lerp(c.purrLevel, targetPurr, 1 - Math.exp(-(targetPurr > c.purrLevel ? 6.5 : 6.5) * clampedDt));
      if (c.purrLevel < 0.005) c.purrLevel = 0;

      if (c.purrLevel > 0.22) {
        c.purrSparkTimer -= clampedDt;
        if (c.purrSparkTimer <= 0) {
          c.purrSparkTimer = 0.24 + (1 - c.purrLevel) * 0.28;
          const s = c.scale * u;
          const label = Math.random() < 0.34 ? 'prrr~' : (Math.random() < 0.5 ? '~' : '*');
          this.purrSparks.push({
            x: c.x + (Math.random() - 0.5) * 11 * s,
            y: c.y - (11 + Math.random() * 4) * s,
            vx: (Math.random() - 0.5) * 2.2,
            vy: -4.2 - Math.random() * 2.2,
            label,
            life: 0,
            maxLife: 1.05 + Math.random() * 0.35,
          });
          if (this.purrSparks.length > 14) this.purrSparks.shift();
        }
      }

      if (this.typingMode) {
        const seatX = this.keyboard.centerX;
        const seatY = this.keyboard.top + 1.5;
        c.x = lerp(c.x, seatX, 1 - Math.exp(-10 * clampedDt));
        c.y = lerp(c.y, seatY, 1 - Math.exp(-10 * clampedDt));
        c.vx = 0;
        c.vy = 0;
        c.speed = 0;
        c.pose = 'sit';
        c.idleTime += clampedDt;

        const updatePaw = (paw, home) => {
          if (paw.hold > 0) {
            paw.hold = Math.max(0, paw.hold - clampedDt);
            paw.x = lerp(paw.x, paw.tx, 1 - Math.exp(-34 * clampedDt));
            paw.y = lerp(paw.y, paw.ty, 1 - Math.exp(-34 * clampedDt));
          } else {
            const breathe = Math.sin(this.time * 3.2) * 0.2;
            paw.x = lerp(paw.x, home.x, 1 - Math.exp(-12 * clampedDt));
            paw.y = lerp(paw.y, home.y + breathe, 1 - Math.exp(-12 * clampedDt));
          }
          paw.strike = Math.max(0, paw.strike - clampedDt * 4.5);
        };
        updatePaw(this.typing.leftPaw, this.keyboard.homeLeft);
        updatePaw(this.typing.rightPaw, this.keyboard.homeRight);

        this.typing.headBob = Math.max(0, this.typing.headBob - clampedDt * 6.5);
        this.typing.lookX = lerp(this.typing.lookX, 0, 1 - Math.exp(-3.5 * clampedDt));

        const active = this.typing.activeKeys;
        for (const k in active) {
          active[k] -= clampedDt;
          if (active[k] <= 0) delete active[k];
        }
      } else {
        let ix = input.moveX;
        let iy = input.moveY;
        let isAutoWander = false;

        if (c.boxCooldown > 0) c.boxCooldown = Math.max(0, c.boxCooldown - clampedDt);
        if (this.box.wiggle > 0) this.box.wiggle = Math.max(0, this.box.wiggle - clampedDt * 3.0);

        if (ix !== 0 || iy !== 0) {
          c.targetX = null;
          c.targetY = null;
          c.targetBowlId = null;
          c.targetBox = false;
          c.autoTargetX = null;
          c.autoTargetY = null;
          this.leaveBox(2.8);
          c.wanderTimer = 4.5 + Math.random() * 3.5;
        } else if (c.targetBox) {
          const dx = this.box.x - c.x;
          const dy = this.box.y - c.y;
          const dist = Math.hypot(dx, dy * 1.5);
          if (dist < 4.0 * u) {
            this.enterBox();
          } else {
            const len = Math.max(0.01, Math.hypot(dx, dy));
            ix = dx / len;
            iy = dy / len;
          }
        } else if (c.targetBowlId !== null) {
          const targetBowl = this.bowls.find((b) => b.id === c.targetBowlId);
          if (!targetBowl) {
            c.targetBowlId = null;
            c.targetX = null;
            c.targetY = null;
          } else {
            this.leaveBox(2.8);
            const dx = targetBowl.x - c.x;
            const dy = targetBowl.y - c.y;
            const dist = Math.hypot(dx, dy * 1.6);
            if (dist < Math.min(36 * u, (9.5 + c.scale * 2.5) * u)) {
              this.eatBowl(targetBowl);
              if (this.onAutoEat) this.onAutoEat();
              c.targetBowlId = null;
              c.targetX = null;
              c.targetY = null;
            } else {
              const len = Math.max(0.01, Math.hypot(dx, dy));
              ix = dx / len;
              iy = dy / len;
            }
          }
        } else if (c.targetX !== null && c.targetY !== null) {
          this.leaveBox(2.8);
          const dx = c.targetX - c.x;
          const dy = c.targetY - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist < (c.targetPond ? 2.4 : 1.8) * u) {
            c.targetX = null;
            c.targetY = null;
            if (c.targetPond) {
              c.targetPond = false;
              const p = this.pond;
              this.spawnPondRipple(p.x + (c.x - p.x) * 0.48, p.y + (c.y - p.y) * 0.48);
              c.meowTimer = 1.45;
              const pondWords = ['*sip*', '*splash*', 'bloop~'];
              c.meowText = pondWords[Math.floor(Math.random() * pondWords.length)];
            }
            c.wanderTimer = 4.0 + Math.random() * 4.0;
          } else {
            ix = dx / dist;
            iy = dy / dist;
          }
        } else if (c.autoTargetX !== null && c.autoTargetY !== null) {
          this.leaveBox(3.0);
          const dx = c.autoTargetX - c.x;
          const dy = c.autoTargetY - c.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 2.2 * u) {
            c.autoTargetX = null;
            c.autoTargetY = null;
            if (Math.hypot(this.box.x - c.x, (this.box.y - c.y) * 1.5) < 6.5 * u && c.boxCooldown <= 0) {
              this.enterBox();
            } else {
              c.idleStageTimer = this.isInSunbeam(c.x, c.y) ? 1.8 + Math.random() * 1.2 : 3.2 + Math.random() * 2.5;
              c.lastIdleAction = 'wander';
            }
          } else {
            ix = dx / dist;
            iy = dy / dist;
            isAutoWander = true;
          }
        }

        let movedX = 0;
        let movedY = 0;
        let movedDist = 0;
        if (c.inBox) {
          // Stay cleanly anchored inside the box (never displaced sideways by room margins!)
          c.x = this.box.x;
          c.y = this.box.y;
          c.vx = 0;
          c.vy = 0;
          c.speed = 0;
        } else {
          const ilen = Math.hypot(ix, iy);
          if (ilen > 0.001) {
            ix /= ilen;
            iy /= ilen;
          }

          const pace = (isAutoWander ? 0.52 : 1.0) * (c.inPond ? 0.68 : 1.0);
          const baseSpeed = (input.sprint ? 44.0 : 30.0) * u * pace;
          const targetVx = ix * baseSpeed;
          const targetVy = iy * baseSpeed * 0.62;

          const accel = ilen > 0.001 ? 22.0 : 18.0;
          c.vx = lerp(c.vx, targetVx, 1 - Math.exp(-accel * clampedDt));
          c.vy = lerp(c.vy, targetVy, 1 - Math.exp(-accel * clampedDt));

          const nextPos = this.clampToRoom(c.x + c.vx * clampedDt, c.y + c.vy * clampedDt);
          movedX = nextPos.x - c.x;
          movedY = nextPos.y - c.y;
          movedDist = Math.hypot(movedX, movedY);

          c.x = nextPos.x;
          c.y = nextPos.y;
          c.speed = movedDist / Math.max(clampedDt, 0.001);
          if (!isAutoWander) {
            c.totalMoved += movedDist;
          }
        }

        // Pond wading, splashing, soaking, dripping, and wet shake-off!
        {
          const wasInPond = c.inPond;
          const nowInPond = !c.inBox && this.isPointOnPond(c.x, c.y);
          c.inPond = nowInPond;
          if (c.shakeTimer > 0) c.shakeTimer = Math.max(0, c.shakeTimer - clampedDt);

          if (nowInPond) {
            c.wetness = Math.min(1.0, c.wetness + clampedDt * 1.45);
            c.pendingShake = false;

            if (!wasInPond) {
              // Stepping into the pond: big cheerful splash + ripples!
              this.spawnPondRipple(c.x, c.y);
              for (let k = 0; k < 6; k++) {
                const side = k % 2 === 0 ? 1 : -1;
                this.spawnDroplet(
                  c.x + side * (2.0 + Math.random() * 2.5) * u,
                  c.y - 0.5,
                  side * (4.5 + Math.random() * 5.5) * u,
                  (-4.2 - Math.random() * 3.5) * u
                );
              }
              if (c.meowTimer <= 0.1) {
                c.meowTimer = 1.5;
                const splashWords = ['*splash*', 'pool time!', 'swim~'];
                c.meowText = splashWords[Math.floor(Math.random() * splashWords.length)];
              }
            }

            // Continuous wading ripples around the cat's submerged paws
            c.pondStepRippleTimer -= clampedDt * (movedDist > 0.04 ? 2.4 : 0.7);
            if (c.pondStepRippleTimer <= 0) {
              c.pondStepRippleTimer = 0.55 + Math.random() * 0.35;
              this.spawnPondRipple(c.x + (Math.random() - 0.5) * 3.0 * u, c.y);
            }
          } else {
            if (wasInPond && c.wetness > 0.35) {
              c.pendingShake = true;
              c.pendingShakeTimer = 0.75;
            }
            if (c.pendingShake) {
              c.pendingShakeTimer -= clampedDt;
              if (c.pendingShakeTimer <= 0 || (c.speed < 2.5 && c.pendingShakeTimer < 0.45)) {
                this.triggerWetShake();
              }
            }
            if (c.wetness > 0) {
              c.wetness = Math.max(0, c.wetness - clampedDt * 0.085);
              if (c.wetness > 0.16) {
                c.wetDripTimer -= clampedDt;
                if (c.wetDripTimer <= 0) {
                  c.wetDripTimer = 0.24 + (1 - c.wetness) * 0.42;
                  const side = Math.random() > 0.5 ? 1 : -1;
                  const sCat = Math.min(c.scale, 3.0) * u;
                  this.spawnDroplet(
                    c.x + side * (3.2 + Math.random() * 2.2) * sCat,
                    c.y - (1.2 + Math.random() * 3.2) * sCat,
                    side * (0.8 + Math.random() * 1.4) * u,
                    (1.2 + Math.random() * 1.6) * u,
                    46
                  );
                }
              }
            }
          }
        }

        // Auto-eat any bowl the cat touches while walking (super smooth on desktop & mobile!)
        if (!isAutoWander && !c.inBox && this.bowls.length > 0) {
          const touchRadius = Math.min(38 * u, (10.5 + c.scale * 3.0) * u);
          for (let i = 0; i < this.bowls.length; i++) {
            const b = this.bowls[i];
            if (b.age < 0.35) continue;
            if (Math.hypot(b.x - c.x, (b.y - (c.y - 2)) * 1.6) < touchRadius) {
              this.eatBowl(b);
              if (this.onAutoEat) this.onAutoEat();
              if (c.targetBowlId === b.id) {
                c.targetBowlId = null;
                c.targetX = null;
                c.targetY = null;
              }
              break;
            }
          }
        }

        // Hop into the cardboard box if the user intentionally walks onto it (never hijack walks passing by)
        if (!c.inBox && c.boxCooldown <= 0 && !isAutoWander && movedDist > 0.02 && c.targetBowlId === null) {
          const boxDist = Math.hypot(this.box.x - c.x, (this.box.y - c.y) * 1.5);
          const aimingAtBox = c.targetBox || (c.targetX === null && (input.moveX !== 0 || input.moveY !== 0)) ||
            (c.targetX !== null && Math.hypot(this.box.x - c.targetX, (this.box.y - c.targetY) * 1.5) < 9.0 * u);
          if (boxDist < 5.0 * u && aimingAtBox) {
            this.enterBox();
          }
        }

        // Cat bumping the yarn ball bats it smoothly across the grass!
        if (movedDist > 0.03) {
          const ydx = this.yarn.x - c.x;
          const ydy = this.yarn.y - c.y;
          const yDist = Math.hypot(ydx, ydy * 1.55);
          const bumpR = Math.min(20 * u, (7.2 + c.scale * 1.9) * u);
          if (yDist < bumpR) {
            const bDirX = Math.abs(c.vx) > 0.5 ? c.vx : ydx;
            const bDirY = Math.abs(c.vy) > 0.5 ? c.vy : ydy;
            const boost = Math.min(54, 26 + c.speed * 0.65 + c.scale * 3.5);
            this.batYarn(bDirX, bDirY, boost);
          }
        }

        if (movedDist > 0.04 && !c.inBox) {
          c.idleTime = 0;
          c.groomTimer = 0;
          c.stridePhase += (movedDist / Math.max(0.7, Math.min(c.scale, 2.6) * u)) * 0.52;

          if (Math.abs(movedX) >= Math.abs(movedY) * 0.72) {
            c.pose = movedX >= 0 ? 'right' : 'left';
            c.lastHoriz = c.pose;
          } else {
            c.pose = movedY < 0 ? 'up' : 'down';
          }

          this.trailTimer += clampedDt;
          if (this.trailTimer > 0.075) {
            this.trailTimer = 0;
            this.trails.push({ x: c.x, y: c.y, r: Math.min(14 * u, 4.5 * c.scale * u), age: 0, maxAge: 3.8 });
            if (this.trails.length > 40) this.trails.shift();
          }
        } else {
          c.speed = 0;
          c.idleTime += clampedDt;

          // Transition from walking pose into sitting cleanly
          if (!c.inBox && c.idleTime > 0.55 && (c.pose === 'right' || c.pose === 'left' || c.pose === 'up' || c.pose === 'down')) {
            c.pose = 'sit';
            c.idleStageTimer = this.isInSunbeam(c.x, c.y) ? 2.0 + Math.random() * 1.4 : 3.6 + Math.random() * 2.4;
          }

          // Expressive idle lifecycle while stationary & undisturbed
          if (c.idleTime > 0.55 || c.inBox) {
            // Curious eye-tracking: watch drifting moth or rolling yarn ball first, otherwise look around!
            if (c.pose === 'sit' || c.pose === 'loaf' || c.pose === 'box') {
              const yarnSpeed = Math.hypot(this.yarn.vx, this.yarn.vy);
              if (this.moth.active && Math.hypot(this.moth.x - c.x, (this.moth.y - c.y) * 1.5) < 62 * u) {
                c.lookTargetX = clamp((this.moth.x - c.x) / (18 * u), -0.85, 0.85);
              } else if (yarnSpeed > 4.0 && Math.hypot(this.yarn.x - c.x, (this.yarn.y - c.y) * 1.5) < 75 * u) {
                c.lookTargetX = clamp((this.yarn.x - c.x) / (20 * u), -0.85, 0.85);
              } else {
                c.lookTimer -= clampedDt;
                if (c.lookTimer <= 0) {
                  c.lookTimer = 2.0 + Math.random() * 2.6;
                  const r = Math.random();
                  c.lookTargetX = r < 0.35 ? -0.75 : r < 0.7 ? 0.75 : 0;
                }
              }
              c.lookX = lerp(c.lookX, c.lookTargetX, 1 - Math.exp(-5.5 * clampedDt));
            } else {
              c.lookX = lerp(c.lookX, 0, 1 - Math.exp(-6.0 * clampedDt));
            }

            if (c.pose === 'groom') {
              c.groomTimer -= clampedDt;
              if (c.groomTimer <= 0) {
                c.pose = 'sit';
                c.idleStageTimer = 3.0 + Math.random() * 2.0;
              }
            } else if (c.purrLevel < 0.15 && c.meowTimer <= 0) {
              const inSun = this.isInSunbeam(c.x, c.y);
              c.idleStageTimer -= clampedDt * (inSun && (c.pose === 'sit' || c.pose === 'loaf') ? 1.55 : 1.0);
              if (c.idleStageTimer <= 0) {
                if (c.pose === 'box') {
                  // Eventually hop out of the box and go explore
                  this.leaveBox(4.5);
                  this.pickAutonomousWanderTarget();
                  c.idleStageTimer = 4.0 + Math.random() * 2.5;
                } else if (c.inPond) {
                  // Enjoy floating in the pool, then eventually hop out onto dry grass
                  this.pickAutonomousWanderTarget();
                  c.idleStageTimer = 6.5 + Math.random() * 4.5;
                } else if (c.pose === 'sit') {
                  const roll = Math.random();
                  if (inSun) {
                    // Inside the warm sunbeam: strongly prefer loafing & napping!
                    if (roll < 0.78) {
                      c.pose = 'loaf';
                      c.idleStageTimer = 5.0 + Math.random() * 3.0;
                      c.lastIdleAction = 'loaf';
                    } else {
                      c.pose = 'groom';
                      c.groomTimer = 2.4 + Math.random() * 1.0;
                      c.groomSide = Math.random() > 0.5 ? 1 : -1;
                      c.lastIdleAction = 'groom';
                    }
                  } else if (c.lastIdleAction === 'wander') {
                    if (roll < 0.52) {
                      c.pose = 'loaf';
                      c.idleStageTimer = 6.5 + Math.random() * 3.5;
                      c.lastIdleAction = 'loaf';
                    } else if (roll < 0.80) {
                      c.pose = 'groom';
                      c.groomTimer = 2.4 + Math.random() * 1.0;
                      c.groomSide = Math.random() > 0.5 ? 1 : -1;
                      c.lastIdleAction = 'groom';
                    } else {
                      this.pickAutonomousWanderTarget();
                      c.idleStageTimer = 4.0 + Math.random() * 2.5;
                    }
                  } else if (roll < 0.44) {
                    this.pickAutonomousWanderTarget();
                    c.idleStageTimer = 4.0 + Math.random() * 2.5;
                  } else if (roll < 0.78) {
                    c.pose = 'loaf';
                    c.idleStageTimer = 6.5 + Math.random() * 3.5;
                    c.lastIdleAction = 'loaf';
                  } else {
                    c.pose = 'groom';
                    c.groomTimer = 2.4 + Math.random() * 1.0;
                    c.groomSide = Math.random() > 0.5 ? 1 : -1;
                    c.lastIdleAction = 'groom';
                  }
                } else if (c.pose === 'loaf') {
                  if (Math.random() < (inSun ? 0.88 : 0.72)) {
                    c.pose = 'sleep';
                    c.idleStageTimer = (inSun ? 16.0 : 12.0) + Math.random() * 7.0;
                    c.sleepZTimer = 0.35;
                    c.lastIdleAction = 'sleep';
                  } else {
                    c.pose = 'sit';
                    c.idleStageTimer = 3.2 + Math.random() * 2.0;
                  }
                } else if (c.pose === 'sleep') {
                  c.pose = 'sit';
                  c.earTwitchDuration = 0.28;
                  c.idleStageTimer = 3.8 + Math.random() * 2.5;
                  c.lastIdleAction = 'wake';
                }
              }
            }

            // Spawn peaceful drifting 'z' / 'Z' sleep bubbles while curled up asleep
            if (c.pose === 'sleep') {
              c.sleepZTimer -= clampedDt;
              if (c.sleepZTimer <= 0) {
                c.sleepZTimer = 0.95 + Math.random() * 0.45;
                const s = c.scale * u;
                const big = Math.random() > 0.48;
                this.sleepZs.push({
                  x: c.x + (4.2 + Math.random() * 1.5) * s,
                  y: c.y - (5.6 + Math.random() * 1.2) * s,
                  vx: 1.4 + Math.random() * 1.0,
                  vy: -3.2 - Math.random() * 1.0,
                  ch: big ? 90 : 122, // 'Z' or 'z'
                  phase: Math.random() * Math.PI * 2,
                  life: 0,
                  maxLife: 2.3 + Math.random() * 0.6,
                });
                if (this.sleepZs.length > 8) this.sleepZs.shift();
              }
            }
          }
        }
      }

      // Physics ball of yarn (corner-proof inward bounces, pond edge splash bounce, trailing ASCII thread!)
      {
        const y = this.yarn;
        const spd = Math.hypot(y.vx, y.vy);
        if (spd > 0.08) {
          y.x += y.vx * clampedDt;
          y.y += y.vy * clampedDt;
          y.spin += (y.vx * 0.24 + y.vy * 0.14) * clampedDt;
          const damp = Math.exp(-2.2 * clampedDt);
          y.vx *= damp;
          y.vy *= damp;

          const minX = Math.max(10 * u, this.cols * 0.10);
          const maxX = Math.min(this.cols - 1 - 10 * u, this.cols * 0.90);
          const minY = this.rows * 0.27;
          const maxY = this.rows - 9;
          const centerPush = 14 * u;
          if (y.x < minX) { y.x = minX; y.vx = Math.max(Math.abs(y.vx) * 0.78, centerPush); }
          if (y.x > maxX) { y.x = maxX; y.vx = -Math.max(Math.abs(y.vx) * 0.78, centerPush); }
          if (y.y < minY) { y.y = minY; y.vy = Math.max(Math.abs(y.vy) * 0.78, centerPush * 0.65); }
          if (y.y > maxY) { y.y = maxY; y.vy = -Math.max(Math.abs(y.vy) * 0.78, centerPush * 0.65); }

          // Soft bounce off pond edge with a cute splash ripple!
          const p = this.pond;
          const pdx = (y.x - p.x) / (p.rx + 2.5 * u);
          const pdy = (y.y - p.y) / (p.ry + 1.5 * u);
          const pd = Math.hypot(pdx, pdy);
          if (pd < 1.0 && pd > 0.01) {
            const nx = pdx / pd;
            const ny = pdy / pd;
            y.x = p.x + nx * (p.rx + 2.5 * u);
            y.y = p.y + ny * (p.ry + 1.5 * u);
            y.vx = nx * Math.max(18 * u, Math.abs(y.vx) * 0.75);
            y.vy = ny * Math.max(12 * u, Math.abs(y.vy) * 0.75);
            this.spawnPondRipple(p.x + nx * p.rx * 0.75, p.y + ny * p.ry * 0.75);
          }

          for (let i = 0; i < this.trees.length; i++) {
            const tr = this.trees[i];
            const dx = y.x - tr.x;
            const dy = (y.y - tr.y) * 1.65;
            const d = Math.hypot(dx, dy);
            const minD = 5.5 * u + 3.0 * tr.scale;
            if (d < minD && d > 0.01) {
              const nx = dx / d;
              const ny = dy / d;
              y.x = tr.x + nx * minD;
              y.y = tr.y + (ny * minD) / 1.65;
              const dot = y.vx * nx + y.vy * ny;
              if (dot < 0) {
                y.vx -= 1.7 * dot * nx;
                y.vy -= 1.7 * dot * ny;
              }
            }
          }

          // Record trailing thread knots smoothly as the yarn rolls
          if (y.tail.length === 0 || Math.hypot(y.tail[0].x - y.x, y.tail[0].y - y.y) > 1.5 * u) {
            y.tail.unshift({ x: y.x, y: y.y });
            if (y.tail.length > 8) y.tail.pop();
          }
        } else {
          y.vx = 0;
          y.vy = 0;
        }
      }

      // Small still pond: occasional serene ambient ripple + ripple expansion
      this.pondRippleTimer -= clampedDt;
      if (this.pondRippleTimer <= 0) {
        this.spawnPondRipple();
        this.pondRippleTimer = this.weather.rainIntensity > 0.2 ? 0.45 + Math.random() * 0.4 : 2.6 + Math.random() * 2.4;
      }
      for (let i = this.pondRipples.length - 1; i >= 0; i--) {
        const pr = this.pondRipples[i];
        pr.age += clampedDt;
        pr.r = lerp(0.5, pr.maxR, pr.age / pr.maxAge);
        if (pr.age >= pr.maxAge) this.pondRipples.splice(i, 1);
      }

      // Subtle ambient weather: gentle passing monochrome drizzle & night fireflies
      {
        const w = this.weather;
        w.rainTimer -= clampedDt;
        if (w.rainTimer <= 0) {
          w.raining = !w.raining;
          w.rainTimer = w.raining ? 13 + Math.random() * 6 : 46 + Math.random() * 34;
          // If it starts drizzling while cat is idle, cat may stroll cozily near a pine tree!
          if (w.raining && !this.typingMode && !c.inBox && c.targetX === null && c.autoTargetX === null) {
            const shelter = this.trees[Math.random() > 0.5 ? 0 : 1];
            const pos = this.clampToRoom(shelter.x + (shelter.x < this.cols * 0.5 ? 9 : -9) * u, shelter.y + 3 * u);
            c.autoTargetX = pos.x;
            c.autoTargetY = pos.y;
          }
        }
        w.rainIntensity = lerp(w.rainIntensity, w.raining ? 1 : 0, 1 - Math.exp(-0.9 * clampedDt));
        if (w.rainIntensity > 0.04) {
          const targetDrops = Math.round((this.cols < 110 ? 14 : 28) * w.rainIntensity);
          while (this.rainDrops.length < targetDrops) {
            this.rainDrops.push({
              x: Math.random() * this.cols,
              y: Math.random() * this.rows,
              spd: 26 + Math.random() * 14,
            });
          }
        }
        for (let i = this.rainDrops.length - 1; i >= 0; i--) {
          const rd = this.rainDrops[i];
          rd.x -= rd.spd * 0.16 * clampedDt;
          rd.y += rd.spd * clampedDt;
          if (rd.y >= this.rows - 3 || rd.x < 0) {
            if (w.rainIntensity > 0.04) {
              rd.x = Math.random() * (this.cols + 12);
              rd.y = -Math.random() * 6;
            } else {
              this.rainDrops.splice(i, 1);
            }
          }
        }

        // Gentle pulsing fireflies at night (local evening/night hours)
        if (w.isNight && !w.raining) {
          const targetFlies = this.cols < 110 ? 5 : 9;
          while (this.fireflies.length < targetFlies) {
            this.fireflies.push({
              x: this.cols * (0.12 + Math.random() * 0.76),
              y: this.rows * (0.28 + Math.random() * 0.56),
              phase: Math.random() * Math.PI * 2,
              drift: 0.4 + Math.random() * 0.6,
            });
          }
          for (let i = 0; i < this.fireflies.length; i++) {
            const ff = this.fireflies[i];
            ff.x += Math.sin(this.time * ff.drift + ff.phase) * 2.2 * u * clampedDt;
            ff.y += Math.cos(this.time * ff.drift * 0.8 + ff.phase) * 1.1 * u * clampedDt;
          }
        } else if (this.fireflies.length > 0) {
          this.fireflies.length = 0;
        }
      }

      // Rare drifting meadow moth (flutters peacefully across the clearing while the cat watches!)
      {
        const m = this.moth;
        if (!m.active) {
          m.cooldown -= clampedDt;
          if (m.cooldown <= 0 && !this.typingMode) {
            const fromLeft = Math.random() > 0.5;
            m.active = true;
            m.x = fromLeft ? 4 : this.cols - 5;
            m.y = this.rows * (0.30 + Math.random() * 0.34);
            m.vx = (fromLeft ? 1 : -1) * (12 + Math.random() * 7) * u;
            m.vy = (Math.random() - 0.5) * 2.5 * u;
            m.phase = Math.random() * Math.PI * 2;
            m.age = 0;
            m.maxAge = 14 + Math.random() * 5;
            m.noticed = false;
          }
        } else {
          m.age += clampedDt;
          m.x += (m.vx + Math.sin(this.time * 2.6 + m.phase) * 3.5 * u) * clampedDt;
          m.y += (m.vy + Math.cos(this.time * 3.4 + m.phase) * 3.2 * u) * clampedDt;
          m.y = clamp(m.y, this.rows * 0.24, this.rows * 0.74);

          // If the moth flutters right near the awake cat's head, cute curious 'mrrp?' + ear twitch!
          if (!m.noticed && !this.typingMode && c.pose !== 'sleep' && c.meowTimer <= 0) {
            const headY = c.y - 8 * Math.min(c.scale, 2.5) * u;
            if (Math.hypot(m.x - c.x, (m.y - headY) * 1.5) < 18 * u) {
              m.noticed = true;
              c.earTwitchDuration = 0.32;
              c.earTwitchSide = m.x >= c.x ? 1 : -1;
              c.meowTimer = 1.4;
              c.meowText = 'mrrp?';
            }
          }

          if (m.age >= m.maxAge || m.x < -4 || m.x > this.cols + 4) {
            m.active = false;
            m.cooldown = 10 + Math.random() * 8;
          }
        }
      }

      if (c.growthPop > 0) {
        c.growthPop = Math.max(0, c.growthPop - clampedDt * 2.0);
      }

      if (c.blinkDuration > 0) {
        c.blinkDuration = Math.max(0, c.blinkDuration - clampedDt);
      } else {
        c.blinkTimer -= clampedDt;
        if (c.blinkTimer <= 0) {
          c.blinkDuration = 0.16;
          c.blinkTimer = 2.6 + hash2i(Math.floor(this.time * 10), 7) * 2.8;
        }
      }

      if (c.earTwitchDuration > 0) {
        c.earTwitchDuration = Math.max(0, c.earTwitchDuration - clampedDt);
      } else {
        c.earTwitchTimer -= clampedDt;
        if (c.earTwitchTimer <= 0) {
          c.earTwitchDuration = 0.24;
          c.earTwitchSide = Math.random() > 0.5 ? 1 : -1;
          c.earTwitchTimer = 3.5 + Math.random() * 4.5;
        }
      }

      if (c.meowTimer > 0) {
        c.meowTimer = Math.max(0, c.meowTimer - clampedDt);
      }

      // Randomly spawn a single bowl of kibble at a time (always strictly inside viewport!)
      for (let i = 0; i < this.bowls.length; i++) {
        this.bowls[i].age += clampedDt;
      }
      if (!this.typingMode && this.bowls.length < 1) {
        this.bowlSpawnTimer -= clampedDt;
        if (this.bowlSpawnTimer <= 0) {
          this.spawnBowl();
          this.bowlSpawnTimer = 3.5 + Math.random() * 3.0;
        }
      }

      // Tree brushing rustle
      for (let i = 0; i < this.trees.length; i++) {
        const t = this.trees[i];
        const d = Math.hypot(t.x - c.x, (t.y - c.y) * 1.45);
        if (d < (16 + c.scale * 4) * t.scale && c.speed > 3.0 && t.rustle < 0.35) {
          t.rustle = 0.9;
          for (let k = 0; k < 3; k++) {
            this.spawnLeaf(t.x + (Math.random() - 0.5) * 16 * t.scale, t.y - 12 * t.scale, c.vx * 0.12, 0);
          }
        }
        t.rustle = Math.max(0, t.rustle - clampedDt * 1.15);
      }

      this.ambientLeafTimer -= clampedDt;
      if (this.ambientLeafTimer <= 0) {
        this.ambientLeafTimer = 2.0 + Math.random() * 2.4;
        const src = this.trees[Math.floor(Math.random() * this.trees.length)];
        this.spawnLeaf(src.x + (Math.random() - 0.5) * 14 * src.scale, src.y - 14 * src.scale, 1.2, 0);
      }

      const nameDist = Math.hypot((c.x - this.nameAnchor.x) * 0.55, (c.y - (this.nameAnchor.y + 6)) * 1.45);
      const targetGlow = clamp(0.45 + (1 - clamp(nameDist / (44 * u), 0, 1)) * 0.55 + (c.meowTimer > 0 ? 0.25 : 0), 0.42, 1.0);
      this.nameAnchor.glow = lerp(this.nameAnchor.glow, targetGlow, 1 - Math.exp(-3.5 * clampedDt));

      for (let i = this.trails.length - 1; i >= 0; i--) {
        this.trails[i].age += clampedDt;
        if (this.trails[i].age >= this.trails[i].maxAge) this.trails.splice(i, 1);
      }

      for (let i = this.ripples.length - 1; i >= 0; i--) {
        const r = this.ripples[i];
        r.radius += r.speed * clampedDt;
        if (r.radius >= r.maxRadius) this.ripples.splice(i, 1);
      }

      for (let i = this.leaves.length - 1; i >= 0; i--) {
        const lf = this.leaves[i];
        lf.life += clampedDt;
        if (lf.life >= lf.maxLife || lf.x > this.cols + 4 || lf.y > this.rows + 4) {
          this.leaves.splice(i, 1);
          continue;
        }
        lf.x += (lf.vx + Math.sin(this.time * 2.8 + lf.phase) * 2.2 * u) * clampedDt;
        lf.y += (lf.vy + Math.cos(this.time * 2.2 + lf.phase) * 0.7 * u) * clampedDt;
      }

      for (let i = this.crumbs.length - 1; i >= 0; i--) {
        const cr = this.crumbs[i];
        cr.life += clampedDt;
        if (cr.life >= cr.maxLife) {
          this.crumbs.splice(i, 1);
          continue;
        }
        cr.x += cr.vx * clampedDt;
        cr.y += cr.vy * clampedDt;
        cr.vy += 6.5 * u * clampedDt;
      }

      for (let i = this.droplets.length - 1; i >= 0; i--) {
        const dr = this.droplets[i];
        dr.life += clampedDt;
        if (dr.life >= dr.maxLife) {
          this.droplets.splice(i, 1);
          continue;
        }
        dr.x += dr.vx * clampedDt;
        dr.y += dr.vy * clampedDt;
        dr.vy += 12.5 * u * clampedDt;
      }

      for (let i = this.purrSparks.length - 1; i >= 0; i--) {
        const sp = this.purrSparks[i];
        sp.life += clampedDt;
        if (sp.life >= sp.maxLife) {
          this.purrSparks.splice(i, 1);
          continue;
        }
        sp.x += sp.vx * clampedDt;
        sp.y += sp.vy * clampedDt;
      }

      for (let i = this.sleepZs.length - 1; i >= 0; i--) {
        const sz = this.sleepZs[i];
        sz.life += clampedDt;
        if (sz.life >= sz.maxLife) {
          this.sleepZs.splice(i, 1);
          continue;
        }
        sz.x += (sz.vx + Math.sin(this.time * 2.4 + sz.phase) * 1.4) * clampedDt;
        sz.y += sz.vy * clampedDt;
      }

      // Smoothly interpolate live multiplayer remote cats & auto-prune any stale peers (40s without heartbeat)
      if (this.remoteCats.size > 0) {
        const nowMs = Date.now();
        const follow = 1 - Math.exp(-11 * clampedDt);
        const fadeStep = clampedDt * 2.6;
        let pruned = false;
        for (const [id, rc] of this.remoteCats) {
          if (nowMs - rc.lastUpdate > 40_000) {
            this.remoteCats.delete(id);
            pruned = true;
            continue;
          }
          rc.targetX = rc.inBox ? this.box.x : rc.nx * this.cols;
          rc.targetY = rc.inBox ? this.box.y : rc.ny * this.rows;
          const prevX = rc.x;
          const prevY = rc.y;
          rc.x = lerp(rc.x, rc.targetX, follow);
          rc.y = lerp(rc.y, rc.targetY, follow);
          rc.scale = lerp(rc.scale, rc.targetScale, 1 - Math.exp(-8 * clampedDt));
          rc.alpha = Math.min(1, rc.alpha + fadeStep);

          const md = Math.hypot(rc.x - prevX, rc.y - prevY);
          rc.speed = md / Math.max(clampedDt, 0.001);
          if (md > 0.02 && !rc.inBox) {
            rc.stridePhase += (md / Math.max(0.7, Math.min(rc.scale, 2.6) * u)) * 0.52;
          }
          if (rc.meowTimer > 0) rc.meowTimer = Math.max(0, rc.meowTimer - clampedDt);
          if (rc.shakeTimer > 0) rc.shakeTimer = Math.max(0, rc.shakeTimer - clampedDt);
          if (rc.blinkDuration > 0) {
            rc.blinkDuration = Math.max(0, rc.blinkDuration - clampedDt);
          } else {
            rc.blinkTimer -= clampedDt;
            if (rc.blinkTimer <= 0) {
              rc.blinkDuration = 0.16;
              rc.blinkTimer = 2.8 + Math.random() * 3.0;
            }
          }
        }
        if (pruned && this.onRemoteCatsChange) {
          this.onRemoteCatsChange();
        }
      }
    }
  }

  global.AsciiRoom = AsciiRoom;
})(window);
