// High-resolution single-draw-call WebGL monochrome ASCII renderer
// Zoomed-out fine ASCII grid with 3D-shaded realistic SDF cat, painterly ink-wash trees, and detailed koi fish
(function (global) {
  'use strict';

  const { clamp, lerp, smoothstep, hash2i, fbm2 } = global.AsciiMath;

  const FIRST_CHAR = 32;
  const CHAR_COUNT = 95; // ASCII 32..126

  // Cohesive photographic monochrome tonal ramps (smooth volumetric 3D shading)
  const FUR_RAMP = '.,:;=-+*#%8WM';
  const TREE_RAMP = '.:;~+*#%8&WM';

  // Precompute seamless 256x256 wind noise table & 1024-entry sine table once at load
  const NOISE_SIZE = 256;
  const NOISE_MASK = NOISE_SIZE - 1;
  const WIND_TABLE = new Float32Array(NOISE_SIZE * NOISE_SIZE);
  for (let y = 0; y < NOISE_SIZE; y++) {
    for (let x = 0; x < NOISE_SIZE; x++) {
      const sx = x / NOISE_SIZE;
      const sy = y / NOISE_SIZE;
      const a = fbm2(sx * 14, sy * 14);
      const b = fbm2((sx - 1) * 14, sy * 14);
      const c = fbm2(sx * 14, (sy - 1) * 14);
      const d = fbm2((sx - 1) * 14, (sy - 1) * 14);
      const wx = sx * sx * (3 - 2 * sx);
      const wy = sy * sy * (3 - 2 * sy);
      WIND_TABLE[y * NOISE_SIZE + x] = a + (b - a) * wx + (c - a + (a - b - c + d) * wx) * wy;
    }
  }

  const SIN_SIZE = 1024;
  const SIN_MASK = SIN_SIZE - 1;
  const SIN_TABLE = new Float32Array(SIN_SIZE);
  for (let i = 0; i < SIN_SIZE; i++) {
    SIN_TABLE[i] = Math.sin((i / SIN_SIZE) * Math.PI * 2) * 0.5 + 0.5;
  }

  const FINE_SIZE = 128;
  const FINE_MASK = FINE_SIZE - 1;
  const FINE_TABLE = new Float32Array(FINE_SIZE * FINE_SIZE);
  for (let y = 0; y < FINE_SIZE; y++) {
    for (let x = 0; x < FINE_SIZE; x++) {
      FINE_TABLE[y * FINE_SIZE + x] = hash2i(x, y);
    }
  }

  // Fast 2D Signed Distance Field primitives for realistic sculpted silhouettes
  function smin(a, b, k) {
    const h = clamp(0.5 + (0.5 * (b - a)) / k, 0.0, 1.0);
    return b + (a - b) * h - k * h * (1.0 - h);
  }

  function sdCircle(px, py, cx, cy, r) {
    return Math.hypot(px - cx, py - cy) - r;
  }

  function sdEllipse(px, py, cx, cy, rx, ry) {
    const dx = (px - cx) / rx;
    const dy = (py - cy) / ry;
    const d = Math.hypot(dx, dy);
    return (d - 1.0) * Math.min(rx, ry);
  }

  function sdCapsule(px, py, ax, ay, bx, by, ra, rb) {
    const pax = px - ax;
    const pay = py - ay;
    const bax = bx - ax;
    const bay = by - ay;
    const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay + 1e-6), 0.0, 1.0);
    const r = ra + (rb - ra) * h;
    return Math.hypot(pax - bax * h, pay - bay * h) - r;
  }

  function sdTriangle(px, py, ax, ay, bx, by, cx, cy) {
    const e0x = bx - ax, e0y = by - ay;
    const e1x = cx - bx, e1y = cy - by;
    const e2x = ax - cx, e2y = ay - cy;
    const v0x = px - ax, v0y = py - ay;
    const v1x = px - bx, v1y = py - by;
    const v2x = px - cx, v2y = py - cy;

    const t0 = clamp((v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y + 1e-6), 0, 1);
    const t1 = clamp((v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y + 1e-6), 0, 1);
    const t2 = clamp((v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y + 1e-6), 0, 1);

    const pq0x = v0x - e0x * t0, pq0y = v0y - e0y * t0;
    const pq1x = v1x - e1x * t1, pq1y = v1y - e1y * t1;
    const pq2x = v2x - e2x * t2, pq2y = v2y - e2y * t2;

    const s = Math.sign(e0x * e2y - e0y * e2x) || 1;
    const d0 = pq0x * pq0x + pq0y * pq0y;
    const d1 = pq1x * pq1x + pq1y * pq1y;
    const d2 = pq2x * pq2x + pq2y * pq2y;
    const minD = Math.min(d0, d1, d2);

    const c0 = s * (v0x * e0y - v0y * e0x);
    const c1 = s * (v1x * e1y - v1y * e1x);
    const c2 = s * (v2x * e2y - v2y * e2x);
    const inside = c0 >= 0 && c1 >= 0 && c2 >= 0;
    return (inside ? -1 : 1) * Math.sqrt(minD);
  }

  // GLSL ES 1.00 single-pass fullscreen ASCII shader
  const VERT_SRC = `
    attribute vec2 aPos;
    varying vec2 vUv;
    void main() {
      vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const FRAG_SRC = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uAtlas;
    uniform sampler2D uCells;
    uniform vec2 uCanvasPx;
    uniform vec2 uOffsetPx;
    uniform vec2 uCellPx;
    uniform vec2 uGridSize;
    uniform float uCharCount;

    void main() {
      vec2 pix = vUv * uCanvasPx;
      vec2 gp = (pix - uOffsetPx) / uCellPx;
      vec2 cell = floor(gp);

      vec3 bg = vec3(0.0196, 0.0196, 0.0235);

      if (cell.x < 0.0 || cell.y < 0.0 || cell.x >= uGridSize.x || cell.y >= uGridSize.y) {
        gl_FragColor = vec4(bg, 1.0);
        return;
      }

      vec2 dataUv = (cell + 0.5) / uGridSize;
      vec4 cdata = texture2D(uCells, dataUv);
      float chIdx = floor(cdata.r * 255.0 + 0.5);
      float lum = cdata.g;

      if (chIdx < 0.5 || lum < 0.025) {
        gl_FragColor = vec4(bg, 1.0);
        return;
      }

      vec2 frac = fract(gp);
      vec2 atlasUv = vec2((chIdx + frac.x) / uCharCount, frac.y);
      float alpha = texture2D(uAtlas, atlasUv).a;

      vec2 d = vUv - 0.5;
      float vig = clamp(1.0 - dot(d, d) * 0.72, 0.56, 1.0);

      float shade = mix(0.08, 1.0, pow(lum, 1.12)) * vig;
      float boost = smoothstep(0.84, 1.0, lum) * 0.12;
      float val = clamp(shade + boost, 0.0, 1.0);

      vec3 col = mix(bg, vec3(val), alpha);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  class AsciiRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.dpr = 1;
      this.cellW = 6;
      this.cellH = 10;
      this.fontSize = 9.5;
      this.aspect = 10 / 6;
      this.cols = 200;
      this.rows = 80;
      this.offsetX = 0;
      this.offsetY = 0;

      this.atlas = document.createElement('canvas');
      this.atlasCtx = this.atlas.getContext('2d');

      this.charBuf = new Uint8Array(1);
      this.lumBuf = new Float32Array(1);
      this.zBuf = new Float32Array(1);
      this.cellTexData = new Uint8Array(4);

      this.gl = null;
      this.ctx2d = null;
      this.initWebGL();
      if (!this.gl) {
        this.ctx2d = canvas.getContext('2d', { alpha: false });
      }

      this.resize();
    }

    initWebGL() {
      const gl =
        this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }) ||
        this.canvas.getContext('experimental-webgl', { alpha: false, antialias: false });
      if (!gl) return;

      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src);
        gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
          gl.deleteShader(sh);
          return null;
        }
        return sh;
      };

      const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
      const fs = compile(gl.FRAGMENT_SHADER, FRAG_SRC);
      if (!vs || !fs) return;

      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

      gl.useProgram(prog);

      const vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'aPos');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      const makeTex = (unit) => {
        const tex = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return tex;
      };

      this.gl = gl;
      this.glProg = prog;
      this.atlasTex = makeTex(0);
      this.cellTex = makeTex(1);

      gl.uniform1i(gl.getUniformLocation(prog, 'uAtlas'), 0);
      gl.uniform1i(gl.getUniformLocation(prog, 'uCells'), 1);
      gl.uniform1f(gl.getUniformLocation(prog, 'uCharCount'), CHAR_COUNT);

      this.uCanvasPx = gl.getUniformLocation(prog, 'uCanvasPx');
      this.uOffsetPx = gl.getUniformLocation(prog, 'uOffsetPx');
      this.uCellPx = gl.getUniformLocation(prog, 'uCellPx');
      this.uGridSize = gl.getUniformLocation(prog, 'uGridSize');
    }

    resize() {
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      this.canvas.width = Math.floor(vw * this.dpr);
      this.canvas.height = Math.floor(vh * this.dpr);
      this.canvas.style.width = vw + 'px';
      this.canvas.style.height = vh + 'px';

      // Zoomed-out high-resolution ASCII cells for rich, realistic feline, tree, and fish detail!
      if (vw < 540) {
        this.cellW = 5;
        this.cellH = 9;
        this.fontSize = 8.5;
      } else if (vw < 1100 || vh < 680) {
        this.cellW = 5.5;
        this.cellH = 9.5;
        this.fontSize = 9.0;
      } else {
        this.cellW = 6;
        this.cellH = 10;
        this.fontSize = 9.5;
      }

      this.aspect = this.cellH / this.cellW;
      this.cols = Math.max(68, Math.floor(vw / this.cellW));
      this.rows = Math.max(46, Math.floor(vh / this.cellH));

      this.offsetX = Math.floor(((vw - this.cols * this.cellW) * 0.5) * this.dpr);
      this.offsetY = Math.floor(((vh - this.rows * this.cellH) * 0.5) * this.dpr);

      const total = this.cols * this.rows;
      this.charBuf = new Uint8Array(total);
      this.lumBuf = new Float32Array(total);
      this.zBuf = new Float32Array(total);
      this.cellTexData = new Uint8Array(total * 4);

      this.bakeAtlas();

      if (this.gl) {
        const gl = this.gl;
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        gl.useProgram(this.glProg);
        gl.uniform2f(this.uCanvasPx, this.canvas.width, this.canvas.height);
        gl.uniform2f(this.uOffsetPx, this.offsetX, this.offsetY);
        gl.uniform2f(this.uCellPx, this.pxCellW, this.pxCellH);
        gl.uniform2f(this.uGridSize, this.cols, this.rows);

        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.cellTexData);
      }
    }

    bakeAtlas() {
      const cw = Math.max(6, Math.round(this.cellW * this.dpr));
      const ch = Math.max(10, Math.round(this.cellH * this.dpr));
      this.pxCellW = cw;
      this.pxCellH = ch;

      this.atlas.width = CHAR_COUNT * cw;
      this.atlas.height = ch;

      const actx = this.atlasCtx;
      actx.clearRect(0, 0, this.atlas.width, this.atlas.height);
      actx.textAlign = 'center';
      actx.textBaseline = 'middle';

      const fontPx = Math.round(this.fontSize * this.dpr);
      const fontFamily = "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Consolas', 'Courier New', monospace";
      actx.font = `600 ${fontPx}px ${fontFamily}`;
      actx.fillStyle = '#ffffff';

      const cy = ch * 0.53;
      for (let ci = 0; ci < CHAR_COUNT; ci++) {
        const chStr = String.fromCharCode(FIRST_CHAR + ci);
        if (chStr === ' ') continue;
        actx.fillText(chStr, ci * cw + cw * 0.5, cy);
      }

      if (this.gl) {
        const gl = this.gl;
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas);
      }
    }

    screenToRoom(clientX, clientY) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      return {
        x: (clientX - (vw - this.cols * this.cellW) * 0.5) / this.cellW,
        y: (clientY - (vh - this.rows * this.cellH) * 0.5) / this.cellH,
      };
    }

    plot(col, row, chCode, lum, z) {
      if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
      const idx = row * this.cols + col;
      if (z < this.zBuf[idx]) return;
      this.charBuf[idx] = chCode;
      this.lumBuf[idx] = clamp(lum, 0, 1);
      this.zBuf[idx] = z;
    }

    clearHaloCell(col, row, z) {
      if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
      const idx = row * this.cols + col;
      if (z < this.zBuf[idx]) return;
      this.charBuf[idx] = 32;
      this.lumBuf[idx] = 0;
      this.zBuf[idx] = z;
    }

    darkenCell(col, row, mult) {
      if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
      const idx = row * this.cols + col;
      this.lumBuf[idx] *= mult;
    }

    render(room) {
      this.charBuf.fill(32);
      this.lumBuf.fill(0);
      this.zBuf.fill(-1e6);

      // 1. High-resolution sweeping wind-swept meadow + serene still pond + subtle night sky
      this.renderMeadow(room);
      if (room.typingBlend < 0.85) {
        this.renderPond(room);
        this.renderSkyMoonStars(room);
        this.renderSunbeamMotes(room);
        this.renderFireflies(room);
        this.renderRain(room);
      }

      // 2. Symmetrical soft parted-grass clearings behind header & bottom control bar
      this.renderNameClearing(room);
      this.renderBottomClearing(room);

      // 3. Y-sorted painterly trees, cardboard box (back/front), yarn ball, food bowl, local cat, and remote multiplayer cats
      const entities = [
        { sortY: room.trees[0].y, fn: () => this.renderTree(room.trees[0], room) },
        { sortY: room.trees[1].y, fn: () => this.renderTree(room.trees[1], room) },
        { sortY: room.cat.y, fn: () => this.renderCat(room, room.cat, true) },
      ];
      if (room.typingBlend < 0.85) {
        if (room.remoteCats && room.remoteCats.size > 0) {
          for (const rc of room.remoteCats.values()) {
            entities.push({ sortY: rc.y - 250, fn: () => this.renderCat(room, rc, false) });
          }
        }
        entities.push({ sortY: room.box.y - 0.6, fn: () => this.renderBoxBack(room) });
        entities.push({ sortY: room.box.y + 0.6, fn: () => this.renderBoxFront(room) });
        entities.push({ sortY: room.yarn.y, fn: () => this.renderYarn(room) });
        for (let i = 0; i < room.bowls.length; i++) {
          const b = room.bowls[i];
          entities.push({ sortY: b.y, fn: () => this.renderBowl(b, room) });
        }
      }
      entities.sort((a, b) => a.sortY - b.sortY);
      for (let i = 0; i < entities.length; i++) {
        entities[i].fn();
      }

      // 4. Typing-mode monochrome ASCII QWERTY keyboard and reaching cat paws (unobstructed view!)
      if (room.typingBlend > 0.04) {
        this.renderKeyboard(room);
        this.renderTypingPaws(room);
      }

      // 5. Drifting moth, falling leaves (behind cat), eating crumbs, purr sparkles, and sleeping zZz
      if (room.typingBlend < 0.7) {
        this.renderMoth(room);
      }
      this.renderLeaves(room);
      this.renderCrumbs(room);
      this.renderDroplets(room);
      this.renderPurrSparks(room);
      this.renderSleepZs(room);

      // 6. Single-draw-call WebGL flush
      if (this.gl) {
        this.flushWebGL();
      } else {
        this.flushCanvas2D();
      }
    }

    renderMeadow(room) {
      const cols = this.cols;
      const rows = this.rows;
      const t = room.time;
      const cat = room.cat;
      const u = room.getBaseUnitScale();
      const trails = room.trails;
      const ripples = room.ripples;
      const hasTrails = trails.length > 0;
      const hasRipples = ripples.length > 0;

      const sb = room.sunbeam;
      const sbX = sb.x;
      const sbY = sb.y;
      const invSbRx = 1 / Math.max(1, sb.rx);
      const invSbRy = 1 / Math.max(1, sb.ry);
      const sbPulse = 0.88 + Math.sin(t * 0.7) * 0.12;

      const windShiftX = Math.floor(t * 20.0);
      const windShiftY = Math.floor(Math.sin(t * 0.35) * 8.0);
      const gustPhaseBase = Math.floor(t * 320);

      let trMinX = 1e9, trMaxX = -1e9, trMinY = 1e9, trMaxY = -1e9;
      if (hasTrails) {
        for (let i = 0; i < trails.length; i++) {
          const tr = trails[i];
          const rad = tr.r || 5.0;
          if (tr.x - rad < trMinX) trMinX = tr.x - rad;
          if (tr.x + rad > trMaxX) trMaxX = tr.x + rad;
          if (tr.y - rad * 0.7 < trMinY) trMinY = tr.y - rad * 0.7;
          if (tr.y + rad * 0.7 > trMaxY) trMaxY = tr.y + rad * 0.7;
        }
      }

      const catX = cat.x;
      const catY = cat.y;
      const catAuraR = Math.min(54 * u, (22 + cat.scale * 7) * u);
      const catAuraR2 = catAuraR * catAuraR;
      const invCatAuraR2 = 1 / catAuraR2;
      const partR = Math.min(28 * u, (10 + cat.scale * 3.5) * u);
      const partR2 = partR * partR;
      const invPartR = 1 / partR;
      const flatR = Math.min(14 * u, (4.5 + cat.scale * 1.4) * u);
      const invFlatR = 1 / flatR;

      const charBuf = this.charBuf;
      const lumBuf = this.lumBuf;
      const zBuf = this.zBuf;

      for (let r = 0; r < rows; r++) {
        const rowOff = r * cols;
        const rowInTrails = hasTrails && r >= trMinY && r <= trMaxY;
        const wyIdx = ((r + windShiftY) & NOISE_MASK) << 8;
        const fineRow = (r & FINE_MASK) * FINE_SIZE;
        const cdy = (r - catY) * 1.65;
        const cdy2 = cdy * cdy;
        const rowNearCat = cdy2 < catAuraR2;
        const sdy = (r - sbY) * invSbRy;
        const rowInSun = Math.abs(sdy) < 1.35;

        for (let c = 0; c < cols; c++) {
          const idx = rowOff + c;
          const n = WIND_TABLE[wyIdx | (((c >> 1) - windShiftX) & NOISE_MASK)];
          const gust = SIN_TABLE[(c * 11 + r * 9 - gustPhaseBase + ((n * 420) | 0)) & SIN_MASK];
          const fine = FINE_TABLE[fineRow + (c & FINE_MASK)];

          let bendDir = 0;
          let flatten = 0;
          let aura = 0;

          if (rowInSun) {
            // Subtle warm diagonal sunbeam pool woven straight into the meadow grass
            const sdx = (c - sbX - (r - sbY) * 0.48) * invSbRx;
            const sd2 = sdx * sdx + sdy * sdy;
            if (sd2 < 1.35) {
              const sf = 1 - sd2 / 1.35;
              aura += sf * sf * 0.145 * sbPulse;
            }
          }

          if (rowNearCat) {
            const cdx = c - catX;
            const cd2 = cdx * cdx + cdy2;
            if (cd2 < catAuraR2) {
              const f = 1 - cd2 * invCatAuraR2;
              aura += f * f * 0.22;
              if (cd2 < partR2) {
                const cdist = Math.sqrt(cd2);
                const inf = 1 - cdist * invPartR;
                bendDir = (cdx >= 0 ? 1 : -1) * inf * 1.45;
                if (cdist < flatR) flatten = (1 - cdist * invFlatR) * 0.9;
              }
            }
          }

          if (rowInTrails && c >= trMinX && c <= trMaxX) {
            for (let i = 0; i < trails.length; i++) {
              const tr = trails[i];
              const rad = tr.r || 5.0;
              const tdx = c - tr.x;
              const tdy = (r - tr.y) * 1.65;
              const td2 = tdx * tdx + tdy * tdy;
              if (td2 < rad * rad) {
                const lifeFade = 1 - tr.age / tr.maxAge;
                const prox = 1 - Math.sqrt(td2) / rad;
                const fl = prox * lifeFade * 0.85;
                if (fl > flatten) flatten = fl;
                bendDir += (tdx >= 0 ? 1 : -1) * prox * lifeFade * 0.6;
              }
            }
          }

          let rippleHit = 0;
          if (hasRipples) {
            const band = 3.2 * u;
            for (let i = 0; i < ripples.length; i++) {
              const rp = ripples[i];
              const rdx = c - rp.x;
              const rdy = (r - rp.y) * 1.65;
              const rd2 = rdx * rdx + rdy * rdy;
              const outer = rp.radius + band;
              const inner = rp.radius > band ? rp.radius - band : 0;
              if (rd2 < outer * outer && rd2 > inner * inner) {
                const diff = Math.abs(Math.sqrt(rd2) - rp.radius);
                const fade = 1 - rp.radius / rp.maxRadius;
                const hit = (1 - diff / band) * fade;
                if (hit > rippleHit) rippleHit = hit;
              }
            }
          }

          const energy = clamp(n * 0.56 + gust * 0.44 + rippleHit * 0.45 - flatten * 0.24, 0, 1);
          let ch;
          if (rippleHit > 0.34) {
            ch = fine > 0.5 ? 43 : (c >= catX ? 62 : 60);
          } else if (flatten > 0.36) {
            ch = fine > 0.5 ? 44 : 46;
          } else if (bendDir > 0.36) {
            ch = 62;
          } else if (bendDir < -0.36) {
            ch = 60;
          } else if (energy > 0.68) {
            ch = gust > 0.54 ? 62 : 60;
          } else if (energy > 0.55) {
            ch = fine > 0.46 ? 43 : 61;
          } else if (energy > 0.42) {
            ch = fine > 0.5 ? 126 : 59;
          } else if (energy > 0.29) {
            ch = fine > 0.5 ? 58 : 45;
          } else {
            // Keep meadow continuous everywhere so wind troughs never create asymmetrical black holes
            ch = fine > 0.48 ? 44 : 46;
          }

          charBuf[idx] = ch;
          const baseLum = 0.085 + energy * 0.265 + gust * 0.055 + aura + rippleHit * 0.34;
          lumBuf[idx] = clamp(flatten > 0.36 ? Math.max(baseLum, 0.13) : baseLum, 0.065, 0.92);
          zBuf[idx] = -1000;
        }
      }
    }

    // Perfectly symmetrical rounded-pill parted-grass clearing behind MATTHEW LI & 2-line history
    renderNameClearing(room) {
      const compact = this.cols < 110;
      const cx = (this.cols - 1) * 0.5;
      const cy = (this.rows - 1) * (compact ? 0.13 : 0.15);
      const flatHalfW = compact ? 18.0 : 28.0;
      const rx = compact ? 13.0 : 15.0;
      const ry = compact ? 6.0 : 6.4;

      const x0 = Math.max(0, Math.floor(cx - flatHalfW - rx - 3));
      const x1 = Math.min(this.cols - 1, Math.ceil(cx + flatHalfW + rx + 3));
      const y0 = Math.max(0, Math.floor(cy - ry - 3));
      const y1 = Math.min(this.rows - 1, Math.ceil(cy + ry + 3));

      for (let r = y0; r <= y1; r++) {
        const dy = (r - cy) / ry;
        const dy2 = dy * dy;
        for (let c = x0; c <= x1; c++) {
          const ax = Math.max(0, Math.abs(c - cx) - flatHalfW) / rx;
          const d2 = ax * ax + dy2;
          if (d2 < 0.78) {
            this.clearHaloCell(c, r, -500);
          } else if (d2 < 1.55) {
            const fade = (d2 - 0.78) / 0.77;
            this.darkenCell(c, r, 0.14 + fade * 0.86);
          }
        }
      }
    }

    // Subtle symmetric dark pillow behind the bottom instructions & leave-a-message bar
    renderBottomClearing() {
      const compact = this.cols < 110;
      const cx = (this.cols - 1) * 0.5;
      const cy = this.rows - 2.2;
      const flatHalfW = compact ? 28.0 : 54.0;
      const rx = compact ? 10.0 : 14.0;
      const ry = 2.6;

      const x0 = Math.max(0, Math.floor(cx - flatHalfW - rx));
      const x1 = Math.min(this.cols - 1, Math.ceil(cx + flatHalfW + rx));
      const y0 = Math.max(0, Math.floor(cy - ry - 1));
      const y1 = this.rows - 1;

      for (let r = y0; r <= y1; r++) {
        const dy = (r - cy) / ry;
        const dy2 = dy * dy;
        for (let c = x0; c <= x1; c++) {
          const ax = Math.max(0, Math.abs(c - cx) - flatHalfW) / rx;
          const d2 = ax * ax + dy2;
          if (d2 < 0.85) {
            this.clearHaloCell(c, r, -500);
          } else if (d2 < 1.55) {
            const fade = (d2 - 0.85) / 0.70;
            this.darkenCell(c, r, 0.18 + fade * 0.82);
          }
        }
      }
    }

    renderShadowEllipse(cx, cy, rx, ry, strength) {
      const x0 = Math.floor(cx - rx - 1);
      const x1 = Math.ceil(cx + rx + 1);
      const y0 = Math.floor(cy - ry - 1);
      const y1 = Math.ceil(cy + ry + 1);
      for (let r = y0; r <= y1; r++) {
        for (let c = x0; c <= x1; c++) {
          const dx = (c - cx) / rx;
          const dy = (r - cy) / ry;
          const d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            this.darkenCell(c, r, 1 - (1 - d2) * strength);
          }
        }
      }
    }

    // PAINTERLY INK-WASH VOLUMETRIC PINE TREE (curved trunk, branches, layered shaded foliage clouds!)
    renderTree(tree, room) {
      const cx = tree.x;
      const cy = tree.y;
      const s = tree.scale;
      const t = room.time;
      const asp = this.aspect;
      const sway = Math.sin(t * 1.4 + tree.seed) * 0.9 + Math.sin(t * 10.5 + tree.seed) * tree.rustle * 1.8;

      // Ground contact shadow
      this.renderShadowEllipse(cx + 2.5 * s, cy + 1.0 * s, 14.5 * s, 4.2 * s, 0.54);

      // Foliage cloud clusters in true-aspect local coords (u, v) where v=0 is ground, negative is UP
      const clusters = [
        { x: -7.2, y: -15.6, rx: 7.5, ry: 4.2, sw: 0.45 },
        { x: -1.6, y: -16.2, rx: 7.6, ry: 4.2, sw: 0.48 },
        { x: 6.8, y: -16.8, rx: 7.2, ry: 4.0, sw: 0.48 },
        { x: 0.4, y: -19.2, rx: 8.8, ry: 4.6, sw: 0.56 },
        { x: -5.8, y: -23.6, rx: 6.6, ry: 3.9, sw: 0.72 },
        { x: 5.4, y: -24.2, rx: 6.4, ry: 3.7, sw: 0.74 },
        { x: -0.4, y: -27.5, rx: 7.2, ry: 4.3, sw: 0.88 },
        { x: 0.0, y: -33.0, rx: 4.9, ry: 3.7, sw: 1.05 },
      ];

      const radX = Math.ceil(18 * s);
      const topRows = Math.ceil((40 * s) / asp);
      const botRows = Math.ceil((3 * s) / asp);
      const x0 = Math.max(0, Math.floor(cx - radX));
      const x1 = Math.min(this.cols - 1, Math.ceil(cx + radX));
      const y0 = Math.max(0, Math.floor(cy - topRows));
      const y1 = Math.min(this.rows - 1, Math.ceil(cy + botRows));

      for (let r = y0; r <= y1; r++) {
        const v = ((r - cy) * asp) / s;
        for (let c = x0; c <= x1; c++) {
          const u = (c - cx) / s;

          let bestFoliage = 1e9;
          let bestNx = 0;
          let bestNy = 0;

          for (let i = 0; i < clusters.length; i++) {
            const cl = clusters[i];
            const cu = u - (cl.x + sway * cl.sw);
            const cv = v - cl.y;
            const d = sdEllipse(cu, cv, 0, 0, cl.rx, cl.ry);
            if (d < bestFoliage) {
              bestFoliage = d;
              bestNx = cu / cl.rx;
              bestNy = cv / cl.ry;
            }
          }

          const noiseVal = WIND_TABLE[(((Math.floor(u * 6 + tree.seed * 7)) & NOISE_MASK) << 8) | ((Math.floor(v * 6 + tree.seed * 11)) & NOISE_MASK)];
          const dLeaf = bestFoliage + (noiseVal - 0.5) * 2.8;

          if (dLeaf < 0.0) {
            const nz = Math.sqrt(Math.max(0.12, 1 - clamp(bestNx * bestNx * 0.65 + bestNy * bestNy * 0.65, 0, 0.92)));
            // Half-Lambert directional moonlight from top-left for rich cohesive ink-wash canopy
            const ndotl = -bestNx * 0.48 - bestNy * 0.50 + nz * 0.62;
            const wrap = clamp(ndotl * 0.5 + 0.5, 0, 1);
            const rim = smoothstep(-1.3, -0.05, dLeaf) * 0.16;
            const heightLift = clamp((-v - 12) / 26, 0, 1) * 0.14;
            const lum = clamp(0.22 + wrap * 0.54 + rim + heightLift + (noiseVal - 0.5) * 0.16, 0.22, 0.94);

            const rIdx = Math.min(TREE_RAMP.length - 1, Math.floor(lum * TREE_RAMP.length));
            const ch = TREE_RAMP.charCodeAt(rIdx);
            this.plot(c, r, ch, lum, tree.y + 0.15);
            continue;
          }

          // Curved tapered organic trunk, root flare, and spreading lower boughs
          const curve = Math.sin(v * 0.12 + tree.seed) * 0.85 + sway * clamp(-v / 32, 0, 1) * 0.22;
          const dTrunk = sdCapsule(u, v, curve * 0.3, 0.4, curve, -20.5, 2.3, 1.0);
          const dRootL = sdCapsule(u, v, 0.0, -1.2, -3.4, 0.8, 1.1, 0.45);
          const dRootR = sdCapsule(u, v, 0.0, -1.2, 3.2, 0.9, 1.0, 0.45);
          const dBoughL = sdCapsule(u, v, curve * 0.7, -11.5, -7.2 + sway * 0.45, -15.2, 0.95, 0.45);
          const dBoughR = sdCapsule(u, v, curve * 0.8, -13.0, 6.8 + sway * 0.48, -16.2, 0.9, 0.42);
          const dWood = Math.min(dTrunk, dRootL, dRootR, dBoughL, dBoughR);

          if (dWood < 0.0) {
            const side = clamp((u - curve) / 2.2, -1, 1);
            const bark = clamp(0.48 - side * 0.18 + (noiseVal - 0.5) * 0.12, 0.24, 0.78);
            const ch = dWood < -0.6 ? (noiseVal > 0.5 ? 72 : 73) : (side < 0 ? 47 : 92);
            this.plot(c, r, ch, bark, tree.y);
          }
        }
      }
    }

    // 3D-SHADED VOLUMETRIC PAINTERLY CERAMIC CAT FOOD BOWL
    // Matches the sculptural SDF lighting & shading of the cat and pine trees (no sticker border!)
    renderBowl(bowl, room) {
      const asp = this.aspect;
      const s = room.getBaseUnitScale();
      const cx = Math.round(bowl.x);
      const cy = Math.round(bowl.y);
      const z = bowl.y;
      const appear = clamp(bowl.age / 0.45, 0, 1);
      const sc = s * (0.86 + 0.14 * appear);

      const inRange = Math.hypot(bowl.x - room.cat.x, (bowl.y - (room.cat.y - 2)) * 1.6) < room.getEatReach();
      const highlightBoost = inRange ? 1.08 : 1.0;

      // Sculptural tapered 3D ceramic dish in square-pixel units
      const rTop = 7.0 * sc;
      const ryTop = 2.65 * sc;
      const vTop = -2.3 * sc;

      const rBot = 8.6 * sc;
      const ryBot = 2.15 * sc;
      const vBot = 3.2 * sc;

      // Soft ground contact shadow right under the curved base
      this.renderShadowEllipse(cx, cy + (vBot + ryBot * 0.5) / asp, rBot * 1.15, 2.0 * sc, 0.52 * appear);

      const x0 = Math.max(0, Math.floor(cx - rBot - 2));
      const x1 = Math.min(this.cols - 1, Math.ceil(cx + rBot + 2));
      const y0 = Math.max(0, Math.floor(cy + (vTop - ryTop - 2.0) / asp));
      const y1 = Math.min(this.rows - 1, Math.ceil(cy + (vBot + ryBot + 2.0) / asp));

      // Top-left-front directional key light matching cat & pine trees
      const lx = -0.50;
      const ly = -0.42;
      const lz = 0.76;
      const rimBand = Math.max(0.72 * sc, asp * 0.52);

      for (let r = y0; r <= y1; r++) {
        const v = (r - cy) * asp;
        for (let c = x0; c <= x1; c++) {
          const u = c - cx;

          const uTopRatio = Math.abs(u) / rTop;
          const onTopSpan = uTopRatio <= 1.02;
          const topArc = onTopSpan ? ryTop * Math.sqrt(Math.max(0, 1 - Math.min(1, uTopRatio * uTopRatio))) : 0;
          const vBackRim = vTop - topArc;
          const vFrontRim = vTop + topArc;

          // 1. Back rim arc (guaranteed continuous across top row!)
          if (onTopSpan && v >= vBackRim - rimBand && v <= vBackRim + rimBand * 0.75) {
            const nx = clamp(u / rTop, -1, 1);
            const lum = clamp((0.68 - nx * 0.16) * highlightBoost * appear, 0.36, 0.92);
            const ch = uTopRatio > 0.86 ? (u < 0 ? 47 : 92) : (lum > 0.66 ? 61 : 45); // '/', '\' corners, '=' / '-' rim
            this.plot(c, r, ch, lum, z + 0.14);
            continue;
          }

          // 2. Front rim lip (bright glossy porcelain curve cleanly overlapping the kibble!)
          if (onTopSpan && v >= vFrontRim - rimBand * 0.72 && v <= vFrontRim + rimBand * 0.68) {
            const nx = clamp(u / rTop, -1, 1);
            const lum = clamp((0.86 - nx * 0.16) * highlightBoost * appear, 0.48, 0.98);
            const ch = uTopRatio > 0.88 ? (u < 0 ? 92 : 47) : (lum > 0.78 ? 61 : 45);
            this.plot(c, r, ch, lum, z + 0.17);
            continue;
          }

          // 3. Recessed interior cavity + kibble pebbles nestled inside the oval
          if (onTopSpan && v > vBackRim + rimBand * 0.75 && v < vFrontRim - rimBand * 0.72) {
            const kh = hash2i(c + bowl.id * 19, r + bowl.id * 37);
            const depth = (v - vBackRim) / Math.max(0.1, vFrontRim - vBackRim);
            if (depth > 0.25) {
              const kLum = clamp((0.52 + kh * 0.34 - (u / rTop) * 0.12) * highlightBoost * appear, 0.28, 0.90);
              const ch = kh > 0.62 ? 111 : kh > 0.30 ? 42 : 43; // 'o', '*', '+' kibble nuggets
              this.plot(c, r, ch, kLum, z + 0.15);
            } else {
              // Dark recessed back wall shadow inside the bowl
              const shLum = clamp((0.20 + (u / rTop) * 0.08) * appear, 0.14, 0.34);
              this.plot(c, r, 58, shLum, z + 0.13);
            }
            continue;
          }

          // 4. Continuous sculpted 3D-lit tapered ceramic outer body
          if (v >= vTop && v <= vBot + ryBot) {
            const h = clamp((v - vTop) / Math.max(0.01, vBot - vTop), 0, 1);
            const rAtV = lerp(rTop, rBot, h);
            if (Math.abs(u) <= rAtV) {
              const uBotNorm = clamp(u / rBot, -1, 1);
              const vBase = vBot + ryBot * Math.sqrt(Math.max(0, 1 - uBotNorm * uBotNorm));
              if (v <= vBase && (!onTopSpan || v > vFrontRim + rimBand * 0.68)) {
                const nx = clamp(u / Math.max(0.1, rAtV), -1, 1);
                const nz = Math.sqrt(Math.max(0.08, 1 - nx * nx));
                const ny = -0.20;

                const ndotl = Math.max(0, nx * lx + ny * ly + nz * lz);
                const wrap = clamp(ndotl * 0.55 + 0.45, 0, 1);
                // Smooth specular porcelain sheen on the left-front curve
                const spec = Math.pow(Math.max(0, nx * -0.46 + nz * 0.89), 7) * 0.28;
                // Gentle grounding AO at base contact
                const baseAO = clamp((vBase - v) / (1.3 * sc), 0.72, 1.0);

                const lum = clamp((0.24 + wrap * 0.52 + spec) * baseAO * highlightBoost * appear, 0.26, 0.96);
                const rIdx = Math.min(FUR_RAMP.length - 1, Math.floor(lum * FUR_RAMP.length));
                this.plot(c, r, FUR_RAMP.charCodeAt(rIdx), lum, z + 0.16);
              }
            }
          }
        }
      }
    }

    // MINIMALIST 3D OPEN CARDBOARD BOX — BACK LAYER
    // Adapts physically to cat size: normal open box -> bowing strained walls -> crushed flat under a giant cat!
    renderBoxBack(room) {
      const box = room.box;
      const cat = room.cat;
      const compact = this.cols < 110;
      const uUnit = room.getBaseUnitScale();
      const baseMult = compact ? 1.14 : uUnit * 1.12;
      const wig = box.wiggle > 0 ? Math.sin(room.time * 36) * box.wiggle * 0.45 : 0;
      const cx = Math.round(box.x + wig);
      const cy = Math.round(box.y);
      const z = box.y - 0.6;
      const halfW = Math.round(8.2 * uUnit);
      const isCrushed = cat.inBox && cat.pose === 'box' && cat.scale > 2.15;

      // Stage 3: Giant cat (>2.15x) pancaked the cardboard box flat — splayed cardboard flaps peek out on both sides!
      if (isCrushed) {
        const catSpan = Math.round(11.8 * cat.scale * baseMult);
        const flatW = Math.min(Math.round(this.cols * 0.34), Math.max(Math.round(halfW * 1.7), catSpan + Math.round(5.5 * uUnit)));
        this.renderShadowEllipse(cx, cy + 1.4, flatW * 1.08, 2.4 * uUnit, 0.54);
        for (let r = cy - 1; r <= cy + 1; r++) {
          const edgeShrink = r === cy - 1 ? 2 : 0;
          for (let c = cx - flatW + edgeShrink; c <= cx + flatW - edgeShrink; c++) {
            const nx = (c - cx) / Math.max(1, flatW);
            const lum = clamp(0.68 - nx * 0.16 - (r - (cy - 1)) * 0.06, 0.28, 0.84);
            const isLeftEdge = c === cx - flatW + edgeShrink;
            const isRightEdge = c === cx + flatW - edgeShrink;
            const ch = isLeftEdge ? 47 : isRightEdge ? 92 : (r === cy - 1 ? 45 : (Math.abs(c - cx) % 3 === 0 ? 35 : 61));
            this.plot(c, r, ch, lum, z + 0.04);
          }
        }
        return;
      }

      const wallH = Math.max(3, Math.round(3.6 * uUnit));
      const topRow = cy - wallH;
      const backRow = topRow - Math.max(1, Math.round(1.6 * uUnit));
      const bulge = cat.inBox && cat.pose === 'box' && cat.scale > 1.45 ? clamp((cat.scale - 1.4) * 3.4, 0, 2.8) : 0;

      // Soft ground contact shadow beneath the box
      this.renderShadowEllipse(cx, cy + 0.8, (halfW + bulge) * 1.25, 1.9 * uUnit, 0.50);

      // Dark shaded interior cavity of the open box
      for (let r = backRow + 1; r <= topRow; r++) {
        for (let c = cx - halfW + 1; c <= cx + halfW - 1; c++) {
          const depth = (r - backRow) / Math.max(1, topRow - backRow + 1);
          const lum = clamp(0.14 + depth * 0.08, 0.12, 0.24);
          this.plot(c, r, 58, lum, z);
        }
      }

      // Back top edge & angled open side cardboard flaps (flare wider & pushed down when squished!)
      for (let c = cx - halfW; c <= cx + halfW; c++) {
        const edgeLum = clamp(0.62 - ((c - cx) / Math.max(1, halfW)) * 0.14, 0.42, 0.78);
        this.plot(c, backRow, 45, edgeLum, z + 0.05);
      }
      const flapLen = Math.max(2, Math.round((2.6 + bulge * 0.9) * uUnit));
      for (let i = 1; i <= flapLen; i++) {
        const lCol = cx - halfW - i;
        const rCol = cx + halfW + i;
        const flapR = Math.min(topRow + (bulge > 0.3 ? 1 : 0), backRow + Math.floor(i * (bulge > 0.3 ? 0.65 : 0.5)));
        this.plot(lCol, flapR, 47, 0.68 - i * 0.04, z + 0.06);
        this.plot(rCol, flapR, 92, 0.50 - i * 0.04, z + 0.06);
        if (flapR + 1 <= topRow + 1) {
          this.plot(lCol, flapR + 1, 35, 0.54 - i * 0.04, z + 0.04);
          this.plot(rCol, flapR + 1, 42, 0.38 - i * 0.04, z + 0.04);
        }
      }
    }

    // MINIMALIST 3D OPEN CARDBOARD BOX — FRONT LAYER (bows outward when a chonky cat squishes inside!)
    renderBoxFront(room) {
      const box = room.box;
      const cat = room.cat;
      const compact = this.cols < 110;
      const uUnit = room.getBaseUnitScale();
      const baseMult = compact ? 1.14 : uUnit * 1.12;
      const wig = box.wiggle > 0 ? Math.sin(room.time * 36) * box.wiggle * 0.45 : 0;
      const cx = Math.round(box.x + wig);
      const cy = Math.round(box.y);
      const z = box.y + 0.6;
      const halfW = Math.round(8.2 * uUnit);

      // Stage 3: Flattened front lip of the pancaked cardboard box peeks cleanly out below the giant cat!
      if (cat.inBox && cat.pose === 'box' && cat.scale > 2.15) {
        const catSpan = Math.round(11.8 * cat.scale * baseMult);
        const flatW = Math.min(Math.round(this.cols * 0.34), Math.max(Math.round(halfW * 1.7), catSpan + Math.round(5.5 * uUnit)));
        const lipR = cy + 1;
        for (let c = cx - flatW; c <= cx + flatW; c++) {
          const nx = (c - cx) / Math.max(1, flatW);
          const lum = clamp(0.74 - nx * 0.16, 0.36, 0.88);
          const ch = c === cx - flatW ? 92 : c === cx + flatW ? 47 : (Math.abs(c - cx) % 4 === 0 ? 95 : 61);
          this.plot(c, lipR, ch, lum, z + 0.08);
        }
        return;
      }

      const wallH = Math.max(3, Math.round(3.6 * uUnit));
      const topRow = cy - wallH;
      const bulge = cat.inBox && cat.pose === 'box' && cat.scale > 1.45 ? clamp((cat.scale - 1.4) * 3.4, 0, 2.8) : 0;

      // 3D-lit corrugated monochrome cardboard front wall (bows outward smoothly under a squished chonky cat!)
      for (let r = topRow; r <= cy; r++) {
        const vFrac = (r - topRow) / Math.max(1, wallH);
        const rowBulge = Math.round(Math.sin(vFrac * Math.PI) * bulge);
        const rHalfW = halfW + rowBulge;
        for (let c = cx - rHalfW; c <= cx + rHalfW; c++) {
          const nx = (c - cx) / Math.max(1, rHalfW);
          if (r === topRow) {
            const lipLum = clamp(0.84 - nx * 0.16, 0.52, 0.96);
            this.plot(c, r, lipLum > 0.72 ? 61 : 45, lipLum, z + 0.08);
            continue;
          }
          if (c === cx - rHalfW || c === cx + rHalfW) {
            const wallCh = rowBulge > 0 ? (c < cx ? 40 : 41) : 124; // '(' / ')' bowed cardboard wall!
            this.plot(c, r, wallCh, c < cx ? 0.76 : 0.46, z + 0.07);
            continue;
          }
          const flute = ((c + r) & 1) === 0 ? 0.04 : -0.03;
          const baseAO = r === cy ? 0.78 : 1.0;
          const lum = clamp((0.64 - nx * 0.22 - vFrac * 0.14 + flute) * baseAO, 0.24, 0.88);
          const rIdx = Math.min(FUR_RAMP.length - 1, Math.floor(lum * FUR_RAMP.length));
          this.plot(c, r, FUR_RAMP.charCodeAt(rIdx), lum, z + 0.05);
        }
      }

      // If the cat is sitting inside the box, drape its cute fluffy front paws over the front cardboard lip!
      if (cat.inBox && cat.pose === 'box') {
        const pawOff = Math.round(Math.min(halfW - 2, 3.0 * Math.min(cat.scale, 1.65) * uUnit));
        const pLum = 0.94;
        this.plot(cx - pawOff, topRow, 87, pLum, z + 0.25);
        this.plot(cx - pawOff + 1, topRow, 56, pLum * 0.92, z + 0.25);
        this.plot(cx + pawOff - 1, topRow, 56, pLum * 0.92, z + 0.25);
        this.plot(cx + pawOff, topRow, 87, pLum, z + 0.25);
      }
    }

    // 3D-SHADED SPINNING BALL OF YARN + DELICATE TRAILING MONOCHROME THREAD
    renderYarn(room) {
      const y = room.yarn;
      const asp = this.aspect;
      const uUnit = room.getBaseUnitScale();
      const rBall = 3.15 * uUnit;
      const z = y.y;

      // Delicate curved monochrome yarn thread trailing across the grass
      const tail = y.tail;
      for (let i = 0; i < tail.length; i++) {
        const pt = tail[i];
        const fade = 1 - i / Math.max(1, tail.length);
        const lum = clamp(0.24 + fade * 0.34, 0.18, 0.62);
        const ch = i % 3 === 0 ? 126 : i % 3 === 1 ? 45 : 46; // '~', '-', '.'
        this.plot(Math.round(pt.x), Math.round(pt.y), ch, lum, z - 0.1);
      }

      // Soft ground shadow right beneath the rolling yarn ball
      this.renderShadowEllipse(y.x, y.y + (rBall * 0.85) / asp, rBall * 1.15, 1.1 * uUnit, 0.46);

      const x0 = Math.max(0, Math.floor(y.x - rBall - 1));
      const x1 = Math.min(this.cols - 1, Math.ceil(y.x + rBall + 1));
      const y0 = Math.max(0, Math.floor(y.y - (rBall + 1) / asp));
      const y1 = Math.min(this.rows - 1, Math.ceil(y.y + (rBall + 1) / asp));

      const spin = y.spin;
      for (let r = y0; r <= y1; r++) {
        const dv = (r - y.y) * asp;
        for (let c = x0; c <= x1; c++) {
          const du = c - y.x;
          const d2 = du * du + dv * dv;
          if (d2 > rBall * rBall) continue;

          const nx = du / rBall;
          const ny = dv / rBall;
          const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
          const ndotl = Math.max(0, -nx * 0.48 - ny * 0.48 + nz * 0.73);
          const strand = Math.sin((du * Math.cos(spin) - dv * Math.sin(spin)) * 1.9 + dv * 0.9) * 0.14;
          const lum = clamp(0.28 + ndotl * 0.62 + strand, 0.24, 0.96);
          const ch = lum > 0.78 ? 64 : lum > 0.60 ? 56 : lum > 0.44 ? 35 : 126; // '@', '8', '#', '~'
          this.plot(c, r, ch, lum, z + 0.15);
        }
      }
    }

    // REALISTIC 3D-SHADED VOLUMETRIC MONOCHROME ASCII CAT!
    // Continuously scales smoothly all the way up to giant meadow-titan size (room.cat.scale)!
    renderCat(room, catObj, isLocal) {
      const cat = catObj || room.cat;
      const local = isLocal !== false;
      const typingBlend = local ? room.typingBlend : 0;
      const t = room.time;
      const asp = this.aspect;
      const compact = this.cols < 110;
      const uUnit = room.getBaseUnitScale();
      // Softly cap remote visitors' visual scale (~2.25x desktop / ~1.9x mobile) so giant remote cats
      // never swallow the screen or block other people's food & props (your own cat still grows huge!)
      const maxRemoteExtra = compact ? 0.55 : 0.90;
      const visScale = local
        ? cat.scale
        : (cat.scale <= 1.35 ? cat.scale : 1.35 + (1 - Math.exp(-(cat.scale - 1.35) * 0.55)) * maxRemoteExtra);
      const remoteDim = local ? 1.0 : clamp(1.0 - Math.max(0, visScale - 1.2) * 0.30, 0.54, 1.0);
      const lumScale = local ? 1.0 : clamp((cat.alpha !== undefined ? cat.alpha : 1.0) * 0.68 * remoteDim, 0.08, 0.72);
      // Boost mobile default cat scale (1.14) and preserve exact cat.scale when leaving a message!
      const baseMult = compact ? 1.14 : uUnit * 1.12;
      const s = visScale * baseMult;
      const isPurring = cat.purrLevel > 0.24;
      const wet = clamp(cat.wetness || 0, 0, 1);
      const inPond = Boolean(cat.inPond && !cat.inBox && typingBlend < 0.5);
      const shakeOff = cat.shakeTimer > 0 ? Math.sin(t * 54) * Math.min(1, cat.shakeTimer * 2.2) * 0.9 * uUnit : 0;
      const cx = cat.x + (isPurring ? Math.sin(t * 28) * 0.22 * cat.purrLevel : 0) + shakeOff;
      const inBoxSnug = cat.inBox && cat.pose === 'box' && visScale <= 2.15;
      const inBoxSquish = inBoxSnug && visScale > 1.45;
      const squishT = inBoxSquish ? clamp((visScale - 1.45) / 0.70, 0, 1) : 0;
      const inBoxCrushed = cat.inBox && cat.pose === 'box' && visScale > 2.15;
      // Giant cat (>2.15x) sitting on the crushed box adopts a smug cozy loaf right on top of it!
      const pose = inBoxCrushed ? 'loaf' : cat.pose;
      const sideDir = pose === 'left' ? -1 : 1;

      // In the pool: sink cat chest-deep into the water with gentle buoyant bobbing!
      const swimBob = inPond ? Math.sin(t * 3.4 + (cat.seed || 0)) * 0.36 : 0;
      const pondSubmergeV = (pose === 'right' || pose === 'left') ? 5.2 : 6.0;
      const cy = inBoxSnug
        ? cat.y + (2.2 + squishT * 4.4) * uUnit
        : (inPond ? cat.y + (pondSubmergeV * s) / asp + swimBob : cat.y);
      // Layer remote cats cleanly behind your own cat, food bowl, yarn, and box (above grass & pond at -590)
      const z = local ? cat.y + 0.02 : cat.y - 250;

      const isBlinking = cat.blinkDuration > 0;
      const isHappy = cat.meowTimer > 0.35 || isPurring;
      const earTwitch = cat.earTwitchDuration > 0 ? cat.earTwitchSide : 0;
      const moving = cat.speed > 2.5 ? clamp(cat.speed / (22 * uUnit), 0, 1) : 0;
      const stride = cat.stridePhase;
      const bob = Math.abs(Math.sin(stride)) * 0.65 * moving - (local ? room.typing.headBob * 0.7 * typingBlend : 0);
      const popBoost = (cat.growthPop || 0) * 0.14;
      const chonk = clamp((cat.bowlsEaten || 0) * 0.22, 0, 2.6);

      // Soft ground contact shadow scaling smoothly with the cat (skip when tucked inside box or swimming in pool)
      const shadowRx = (cat.pose === 'right' || cat.pose === 'left' ? 11.8 : cat.pose === 'loaf' || cat.pose === 'sleep' || inBoxCrushed ? 10.6 : 8.6) * s;
      if (typingBlend < 0.7 && !inBoxSnug && !inPond) {
        this.renderShadowEllipse(cx, cy + 0.8 * s, shadowRx, 2.4 * s, 0.56 * (1 - typingBlend) * lumScale);
      }

      // Bounding box in true-aspect local coords
      let minU = -14.5, maxU = 15.5, minV = -22.5, maxV = 2.5;
      if (pose === 'right' || pose === 'left') {
        minU = -17.5; maxU = 16.5; minV = -18.5; maxV = 2.5;
      } else if (pose === 'loaf') {
        minU = -13.0; maxU = 14.0; minV = -16.0; maxV = 2.5;
      } else if (pose === 'sleep') {
        minU = -13.0; maxU = 13.5; minV = -12.5; maxV = 2.5;
      }

      const x0 = Math.max(0, Math.floor(cx + minU * s));
      const x1 = Math.min(this.cols - 1, Math.ceil(cx + maxU * s));
      const y0 = Math.max(0, Math.floor(cy + (minV * s) / asp));
      let y1 = Math.min(this.rows - 1, Math.ceil(cy + (maxV * s) / asp));
      // Strict box containment: NEVER let fur clip beneath the cardboard box floor!
      const boxHalfW = Math.round(8.2 * uUnit);
      const boxWallH = Math.max(3, Math.round(3.6 * uUnit));
      const boxTopRow = Math.round(room.box.y) - boxWallH;
      const boxBulge = inBoxSquish ? clamp((cat.scale - 1.4) * 3.4, 0, 2.8) : 0;
      if (inBoxSnug) {
        y1 = Math.min(y1, Math.round(room.box.y));
      } else if (inPond) {
        // Strictly submerge everything below the shimmering pool waterline!
        y1 = Math.min(y1, Math.round(cat.y) - 1);
      }

      const wagSit = Math.sin(t * 2.2) * 1.75;
      const wagWalk = Math.sin(t * 4.0 + stride * 0.4) * 1.45;
      const lEarTw = earTwitch < 0 ? 0.85 : 0;
      const rEarTw = earTwitch > 0 ? 0.85 : 0;
      const groomWave = Math.sin(t * 10.5);
      const groomSide = cat.groomSide || 1;
      const loafBreathe = Math.sin(t * 2.0) * 0.28;
      const sleepBreathe = Math.sin(t * 1.45) * 0.36;

      // 4-beat feline walking leg swing & lift (near & far pairs)
      const lfSwing = Math.sin(stride) * 3.1 * moving;
      const rfSwing = Math.sin(stride + Math.PI) * 3.1 * moving;
      const lhSwing = Math.sin(stride + Math.PI * 0.75) * 3.3 * moving;
      const rhSwing = Math.sin(stride + Math.PI * 1.75) * 3.3 * moving;
      const lfLift = Math.max(0, Math.cos(stride)) * 1.2 * moving;
      const rfLift = Math.max(0, Math.cos(stride + Math.PI)) * 1.2 * moving;
      const lhLift = Math.max(0, Math.cos(stride + Math.PI * 0.75)) * 1.2 * moving;
      const rhLift = Math.max(0, Math.cos(stride + Math.PI * 1.75)) * 1.2 * moving;

      const evalSit = (u, v) => {
        // Liquid-cat squish compression when squeezed inside the box: wider muffin-top belly, lower crouched head!
        const vb = (inBoxSquish ? v * (1 + squishT * 0.26) : v) + bob;
        const squishSpread = inBoxSquish ? squishT * 2.2 : 0;
        // Pear-shaped seated feline haunches & soft chest
        const dHaunch = sdEllipse(u, vb, 0, -4.8, 5.6 + chonk * 0.78 + squishSpread, 4.6 + chonk * 0.32);
        const dChest = sdEllipse(u, vb, 0, -9.3, 3.9 + chonk * 0.45 + squishSpread * 0.65, 3.8);
        const dBody = smin(dHaunch, dChest, 2.3);

        // Tucked front legs & rounded paws resting neatly on the ground
        const dLegL = sdCapsule(u, vb, -1.7, -7.6, -1.8, -1.1, 1.3, 1.15);
        const dLegR = sdCapsule(u, vb, 1.7, -7.6, 1.8, -1.1, 1.3, 1.15);
        const dPawL = sdEllipse(u, vb, -1.9, -0.65, 1.75, 0.95);
        const dPawR = sdEllipse(u, vb, 1.9, -0.65, 1.75, 0.95);
        const dLegs = Math.min(smin(dLegL, dPawL, 0.5), smin(dLegR, dPawR, 0.5));

        // Sculpted round feline head + fluffy cheeks
        const dHead = sdEllipse(u, vb, 0, -13.9, 4.45 + chonk * 0.16, 3.6);
        const dCheeks = sdEllipse(u, vb, 0, -12.9, 4.7 + chonk * 0.2, 2.15);
        const dSkull = smin(dHead, dCheeks, 1.0);

        // Crisp pointed triangular ears (prominent even on small mobile screens!)
        const dEarL = sdTriangle(u, vb, -4.0, -15.5, -4.2 - lEarTw * 0.35, -20.6 + lEarTw, -0.8, -16.9);
        const dEarR = sdTriangle(u, vb, 4.0, -15.5, 4.2 + rEarTw * 0.35, -20.6 + rEarTw, 0.8, -16.9);
        const dEars = Math.min(dEarL, dEarR);

        // Graceful sinuous plush tail curling cleanly up on the right side
        const tx1 = 5.6 + chonk * 0.55;
        const tx2 = 8.9 + chonk * 0.55 + wagSit * 0.45;
        const tx3 = 9.7 + chonk * 0.55 + wagSit;
        const dTail1 = sdCapsule(u, vb, 3.8 + chonk * 0.4, -2.4, tx1, -3.0, 1.2, 1.08);
        const dTail2 = sdCapsule(u, vb, tx1, -3.0, tx2, -6.9, 1.08, 1.0);
        const dTail3 = sdCapsule(u, vb, tx2, -6.9, tx3, -11.2, 1.0, 0.88);
        const dTail = smin(smin(dTail1, dTail2, 1.0), dTail3, 1.0);

        const dTorso = typingBlend > 0.35 ? dBody : smin(dBody, dLegs, 0.8);
        const dMain = smin(dTorso, smin(dSkull, dEars, 0.4), 1.1);
        return { d: (inBoxSnug || inPond) ? dMain : Math.min(dMain, dTail), dTail, dEars, dSkull, dMain, vb };
      };

      // CUTE PAW-LICK / FACE-GROOMING IDLE POSE!
      const evalGroom = (u, v) => {
        const gBob = groomWave * 0.45;
        const vb = v;
        const dHaunch = sdEllipse(u, vb, 0, -4.8, 5.6 + chonk * 0.78, 4.6 + chonk * 0.32);
        const dChest = sdEllipse(u, vb, 0, -9.3, 3.9 + chonk * 0.45, 3.8);
        const dBody = smin(dHaunch, dChest, 2.3);

        // Grounded opposite leg + raised licking paw near cheek!
        const gSide = groomSide;
        const dGroundLeg = sdCapsule(u, vb, -gSide * 1.7, -7.6, -gSide * 1.8, -1.1, 1.3, 1.15);
        const dGroundPaw = sdEllipse(u, vb, -gSide * 1.9, -0.65, 1.75, 0.95);
        const pawTipX = gSide * (2.6 + groomWave * 0.35);
        const pawTipY = -11.9 - groomWave * 0.85;
        const dLickArm = sdCapsule(u, vb, gSide * 2.4, -7.8, pawTipX, pawTipY, 1.25, 1.05);
        const dLickPaw = sdEllipse(u, vb, pawTipX, pawTipY, 1.45, 1.15);
        const dRaisedPaw = smin(dLickArm, dLickPaw, 0.55);

        // Head dips slightly toward the grooming paw
        const hv = vb - gBob;
        const dHead = sdEllipse(u, hv, gSide * 0.45, -13.6, 4.45 + chonk * 0.16, 3.55);
        const dCheeks = sdEllipse(u, hv, gSide * 0.45, -12.7, 4.65 + chonk * 0.2, 2.1);
        const dSkull = smin(dHead, dCheeks, 1.0);
        const dEarL = sdTriangle(u, hv, -3.5 + gSide * 0.45, -15.3, -3.8 + gSide * 0.45, -19.7, -0.6 + gSide * 0.45, -16.6);
        const dEarR = sdTriangle(u, hv, 3.8 + gSide * 0.45, -15.3, 4.0 + gSide * 0.45, -19.7, 0.9 + gSide * 0.45, -16.6);
        const dEars = Math.min(dEarL, dEarR);

        const tx1 = 5.6 + chonk * 0.55;
        const tx2 = 8.9 + chonk * 0.55 + wagSit * 0.3;
        const tx3 = 9.5 + chonk * 0.55 + wagSit * 0.6;
        const dTail1 = sdCapsule(u, vb, 3.8 + chonk * 0.4, -2.4, tx1, -3.0, 1.2, 1.08);
        const dTail2 = sdCapsule(u, vb, tx1, -3.0, tx2, -6.6, 1.08, 1.0);
        const dTail3 = sdCapsule(u, vb, tx2, -6.6, tx3, -10.5, 1.0, 0.88);
        const dTail = smin(smin(dTail1, dTail2, 1.0), dTail3, 1.0);

        const dMain = smin(smin(dBody, smin(dGroundLeg, dGroundPaw, 0.5), 0.8), smin(dSkull, dEars, 0.4), 1.1);
        return { d: Math.min(dMain, dRaisedPaw, dTail), dRaisedPaw, dMain, vb: hv, headShiftX: gSide * 0.45, headShiftY: gBob };
      };

      // COZY TUCKED-IN CAT LOAF POSE (paws tucked neatly underneath plump bread-loaf body!)
      const evalLoaf = (u, v) => {
        const vb = v;
        const dLoaf = sdEllipse(u, vb, -0.8, -3.8 - loafBreathe * 0.5, 7.4 + chonk * 0.85, 3.8 + chonk * 0.35 + loafBreathe);
        const dRump = sdEllipse(u, vb, -5.6 - chonk * 0.35, -3.2, 3.6 + chonk * 0.3, 3.1 + chonk * 0.25);
        const dChest = sdEllipse(u, vb, 3.6 + chonk * 0.25, -3.4, 4.1 + chonk * 0.25, 3.3 + chonk * 0.2);
        const dBody = smin(smin(dLoaf, dRump, 1.8), dChest, 1.6);

        // Round head nestled low and cozy right above the tucked chest!
        const hx = 4.6 + chonk * 0.2;
        const hy = -8.0 - loafBreathe * 0.45;
        const dHead = sdEllipse(u, vb, hx, hy, 4.2 + chonk * 0.14, 3.3);
        const dCheeks = sdEllipse(u, vb, hx + 0.15, hy + 0.9, 4.45 + chonk * 0.18, 1.95);
        const dSkull = smin(dHead, dCheeks, 1.0);

        // Pointed triangular ears on the loaf's head
        const dEarL = sdTriangle(u, vb, hx - 3.6, hy - 1.6, hx - 4.0 - lEarTw * 0.3, hy - 5.6 + lEarTw, hx - 0.8, hy - 2.8);
        const dEarR = sdTriangle(u, vb, hx + 3.5, hy - 1.6, hx + 3.9 + rEarTw * 0.3, hy - 5.6 + rEarTw, hx + 0.8, hy - 2.8);
        const dEars = Math.min(dEarL, dEarR);

        // Snug tail curled neatly around the left haunch
        const dTail1 = sdCapsule(u, vb, -8.2 - chonk * 0.4, -2.2, -9.8 - chonk * 0.4, -4.4 + Math.sin(t * 1.4) * 0.5, 1.15, 0.98);
        const dTail2 = sdCapsule(u, vb, -9.8 - chonk * 0.4, -4.4 + Math.sin(t * 1.4) * 0.5, -7.8 - chonk * 0.3, -6.2, 0.98, 0.85);
        const dTail = smin(dTail1, dTail2, 1.0);

        const dMain = smin(dBody, smin(dSkull, dEars, 0.4), 1.3);
        return { d: Math.min(dMain, dTail), dTail, dMain, vb, hx, hy };
      };

      // CURLED-UP SLEEPING CAT DONUT POSE (slow peaceful breathing + wrapped tail!)
      const evalSleep = (u, v) => {
        const vb = v;
        // Arched fluffy curled sleeping back & lower curl
        const dBack = sdEllipse(u, vb, -2.2, -4.1 - sleepBreathe * 0.7, 6.7 + chonk * 0.8, 3.8 + chonk * 0.38 + sleepBreathe);
        const dBase = sdEllipse(u, vb, 0.5, -2.5, 7.6 + chonk * 0.75, 2.7 + chonk * 0.25);
        const dBody = smin(dBack, dBase, 1.8);

        // Tucked head resting peacefully down on the right paws!
        const hx = 4.6 + chonk * 0.2;
        const hy = -3.7 - sleepBreathe * 0.25;
        const dHead = sdEllipse(u, vb, hx, hy, 3.9 + chonk * 0.14, 2.95);
        const dEarL = sdTriangle(u, vb, hx - 2.9, hy - 1.8, hx - 2.3, hy - 5.6, hx - 0.3, hy - 2.4);
        const dEarR = sdTriangle(u, vb, hx + 0.6, hy - 2.3, hx + 2.7, hy - 5.5, hx + 3.2, hy - 1.7);
        const dEars = Math.min(dEarL, dEarR);

        // Fluffy plush tail curled warmly around the underside right up toward the nose!
        const dTail1 = sdCapsule(u, vb, -7.4 - chonk * 0.4, -2.5, -4.6, -0.65, 1.25, 1.1);
        const dTail2 = sdCapsule(u, vb, -4.6, -0.65, 0.4, -0.55, 1.1, 0.98);
        const dTail3 = sdCapsule(u, vb, 0.4, -0.55, 4.2, -0.85, 0.98, 0.85);
        const dTail = smin(smin(dTail1, dTail2, 1.0), dTail3, 1.0);

        const dMain = smin(dBody, smin(dHead, dEars, 0.4), 1.3);
        return { d: Math.min(dMain, dTail), dTail, dMain, vb, hx, hy };
      };

      const evalSide = (uRaw, v) => {
        const u = uRaw * sideDir;
        const vb = v + bob;

        // Sleek horizontal slightly-arched feline torso (natural quadruped silhouette!)
        const dRump = sdEllipse(u, vb, -4.9, -6.4, 3.8 + chonk * 0.35, 3.15 + chonk * 0.28);
        const dChest = sdEllipse(u, vb, 4.4, -6.6, 3.55 + chonk * 0.3, 3.05 + chonk * 0.25);
        const dSpine = sdCapsule(u, vb, -4.9, -7.2, 4.4, -7.4, 2.7 + chonk * 0.35, 2.65 + chonk * 0.35);
        const dMidBack = sdEllipse(u, vb, -0.2, -7.1, 4.8, 2.95 + chonk * 0.45);
        const dBelly = sdEllipse(u, vb, -0.3, -5.6 + chonk * 0.3, 4.9, 2.45 + chonk * 0.52);
        const dTorso = smin(smin(dRump, dChest, 2.2), smin(smin(dSpine, dMidBack, 1.6), dBelly, 1.6), 1.6);

        // Poised neck + rounded head + cute projecting feline muzzle
        const dNeck = sdCapsule(u, vb, 4.6, -7.4, 7.2, -9.7, 2.45, 2.15);
        const dHead = sdEllipse(u, vb, 8.2, -10.3, 3.45 + chonk * 0.12, 2.85);
        const dMuzzle = sdEllipse(u, vb, 10.8, -9.5, 1.6, 1.15);
        const dSkull = smin(smin(dNeck, dHead, 1.1), dMuzzle, 0.75);

        // Two overlapping pointed triangular ears perched on top of the head
        const dEarNear = sdTriangle(u, vb, 6.0, -12.2, 6.9, -15.8, 8.6, -12.6);
        const dEarFar = sdTriangle(u, vb, 7.8, -12.3, 9.0, -15.5, 10.2, -12.2);
        const dEars = Math.min(dEarNear, dEarFar);

        // 2 Near Legs (bright) + 2 Far Legs (shaded deeper for 3D depth!)
        const dNearFront = sdCapsule(u, vb, 4.8, -5.6, 5.0 + lfSwing, -0.6 - lfLift, 1.25, 0.95);
        const dNearHind = sdCapsule(u, vb, -5.2, -5.6, -5.4 + lhSwing, -0.6 - lhLift, 1.45, 0.95);
        const dNearLegs = Math.min(dNearFront, dNearHind);

        const dFarFront = sdCapsule(u, vb, 3.6, -5.7, 3.8 + rfSwing, -0.8 - rfLift, 1.15, 0.9);
        const dFarHind = sdCapsule(u, vb, -4.0, -5.7, -4.2 + rhSwing, -0.8 - rhLift, 1.35, 0.9);
        const dFarLegs = Math.min(dFarFront, dFarHind);

        // Graceful trailing S-curve tail flowing naturally behind the hindquarters!
        const t1x = -10.4, t1y = -8.2 + wagWalk * 0.3;
        const t2x = -13.2, t2y = -10.6 + wagWalk * 0.75;
        const t3x = -14.6, t3y = -12.4 + wagWalk;
        const dTail1 = sdCapsule(u, vb, -7.2, -6.9, t1x, t1y, 1.15, 1.0);
        const dTail2 = sdCapsule(u, vb, t1x, t1y, t2x, t2y, 1.0, 0.92);
        const dTail3 = sdCapsule(u, vb, t2x, t2y, t3x, t3y, 0.92, 0.8);
        const dTail = smin(smin(dTail1, dTail2, 1.1), dTail3, 1.1);

        const dNear = smin(smin(dTorso, dSkull, 1.1), smin(dNearLegs, dEars, 0.35), 0.75);
        const dAll = Math.min(dNear, dFarLegs, dTail);
        return { d: dAll, dNear, dFarLegs, dTail, dEars, dSkull, u, vb };
      };

      const evalUp = (u, v) => {
        const vb = v + bob;
        const dHaunch = sdEllipse(u, vb, 0, -5.2, 5.6 + chonk * 0.75, 4.5 + chonk * 0.3);
        const dBack = sdEllipse(u, vb, 0, -9.6, 4.5 + chonk * 0.45, 3.7);
        const dHead = sdEllipse(u, vb, 0, -13.6, 4.15 + chonk * 0.15, 3.35);
        const dEarL = sdTriangle(u, vb, -3.6, -15.2, -3.9, -19.2, -0.9, -16.4);
        const dEarR = sdTriangle(u, vb, 3.6, -15.2, 3.9, -19.2, 0.9, -16.4);
        const dPawL = sdCapsule(u, vb, -2.3, -4.0, -2.5, -0.6 - lfLift, 1.3, 1.05);
        const dPawR = sdCapsule(u, vb, 2.3, -4.0, 2.5, -0.6 - rfLift, 1.3, 1.05);

        // Graceful plush tail sweeping clearly out to the right behind the haunches!
        const dTail1 = sdCapsule(u, vb, 1.4, -4.6, 5.6 + wagWalk * 0.55, -7.6, 1.2, 1.05);
        const dTail2 = sdCapsule(u, vb, 5.6 + wagWalk * 0.55, -7.6, 7.2 + wagWalk * 1.15, -12.4, 1.05, 0.88);
        const dTail = smin(dTail1, dTail2, 1.1);

        const dBody = smin(smin(dHaunch, dBack, 2.2), smin(dHead, Math.min(dEarL, dEarR), 0.4), 1.1);
        const dMain = smin(dBody, Math.min(dPawL, dPawR), 0.7);
        return { d: Math.min(dMain, dTail), dTail, dMain, vb };
      };

      const evalDown = (u, v) => {
        const vb = v + bob;
        const dBody = sdEllipse(u, vb, 0, -6.8, 5.2 + chonk * 0.65, 4.9 + chonk * 0.3);
        const dHead = sdEllipse(u, vb, 0, -13.6, 4.4 + chonk * 0.16, 3.55);
        const dEarL = sdTriangle(u, vb, -3.8, -15.3, -4.0, -19.7, -0.9, -16.6);
        const dEarR = sdTriangle(u, vb, 3.8, -15.3, 4.0, -19.7, 0.9, -16.6);
        const dPawL = sdCapsule(u, vb, -2.1, -5.4, -2.2, -0.6 - lfLift, 1.3, 1.05);
        const dPawR = sdCapsule(u, vb, 2.1, -5.4, 2.2, -0.6 - rfLift, 1.3, 1.05);

        // Tail peeking behind right shoulder
        const dTail = sdCapsule(u, vb, 4.8 + chonk * 0.4, -7.2, 7.2 + chonk * 0.4 + wagWalk, -12.8, 1.05, 0.85);

        const dMain = smin(smin(dBody, Math.min(dPawL, dPawR), 0.75), smin(dHead, Math.min(dEarL, dEarR), 0.4), 1.1);
        return { d: Math.min(dMain, dTail), dTail, dMain, vb };
      };

      const evalPose = (u, v) => {
        if (pose === 'sit' || pose === 'box') return evalSit(u, v);
        if (pose === 'groom') return evalGroom(u, v);
        if (pose === 'loaf') return evalLoaf(u, v);
        if (pose === 'sleep') return evalSleep(u, v);
        if (pose === 'right' || pose === 'left') return evalSide(u, v);
        if (pose === 'up') return evalUp(u, v);
        return evalDown(u, v);
      };

      const eps = 0.55;

      for (let r = y0; r <= y1; r++) {
        const v = ((r - cy) * asp) / s;
        // Strict side-wall containment below the cardboard rim so fur NEVER clips through box walls!
        let boxMaxAbsX = 1e9;
        if (inBoxSnug && r >= boxTopRow) {
          const vFrac = clamp((r - boxTopRow) / Math.max(1, boxWallH), 0, 1);
          boxMaxAbsX = boxHalfW + Math.round(Math.sin(vFrac * Math.PI) * boxBulge);
        }
        for (let c = x0; c <= x1; c++) {
          if (inBoxSnug && r >= boxTopRow && Math.abs(c - Math.round(room.box.x)) > boxMaxAbsX) {
            continue;
          }
          const u = ((c - cx) / s) * (1 + wet * 0.085);
          const res = evalPose(u, v);
          const d = res.d;
          if (d >= 0.0) continue;

          // Fast 3-tap SDF gradient normal for velvety Half-Lambert 3D shading
          const gx = evalPose(u + eps, v).d - d;
          const gy = evalPose(u, v + eps).d - d;
          const glen = Math.hypot(gx, gy) + 1e-5;
          const nx = gx / glen;
          const ny = gy / glen;
          const edgeFrac = clamp(-d / 2.8, 0, 1);
          const nz = Math.sqrt(Math.max(0.14, 1 - (1 - edgeFrac) * (1 - edgeFrac)));

          // Half-Lambert 3D wrap moonlight from top-left (zero pitch-black moats!) + gentle rim kiss
          const ndotl = -nx * 0.42 - ny * 0.52 + nz * 0.72;
          const wrap = clamp(ndotl * 0.5 + 0.5, 0, 1);
          const rim = smoothstep(-1.05, -0.04, d) * 0.14;
          const wetSpec = wet > 0.12 ? Math.pow(clamp(ndotl, 0, 1), 3.6) * 0.30 * wet : 0;

          // Subtle soft fur texture + gentle tabby sheen (darker/sleeker with glistening wet streaks when soaked!)
          const furNoise = WIND_TABLE[(((Math.floor(u * 5 + 40)) & NOISE_MASK) << 8) | ((Math.floor(v * 5 + 40)) & NOISE_MASK)];
          const tabby = Math.sin(u * 1.1 + v * 0.55) * 0.045;

          let lum = clamp(
            (0.32 + wrap * 0.54 + rim + tabby + (furNoise - 0.5) * 0.08 + popBoost) * (1 - wet * 0.16) + wetSpec,
            0.24,
            0.98
          );

          // Pose-specific anatomical shading (soft inner ear hollows, subtle chin shadow, 3D far-leg depth)
          if (pose === 'sit' || pose === 'box' || pose === 'down' || pose === 'groom') {
            const vb = res.vb;
            const headY = pose === 'sit' || pose === 'box' ? -13.9 : -13.6;
            const hx = pose === 'groom' ? res.headShiftX : 0;

            if (sdEllipse(u, vb, 0, headY + 5.8, 2.2, 2.4) < 0) {
              lum = clamp(lum + 0.1, 0, 0.96);
            }

            const inEarL = sdTriangle(u, vb, hx - 3.2, headY - 2.0, hx - 3.6 - lEarTw * 0.3, headY - 5.1 + lEarTw, hx - 1.6, headY - 2.8);
            const inEarR = sdTriangle(u, vb, hx + 3.2, headY - 2.0, hx + 3.6 + rEarTw * 0.3, headY - 5.1 + rEarTw, hx + 1.6, headY - 2.8);
            if (inEarL < 0 || inEarR < 0) {
              lum *= 0.58;
            }

            if (Math.abs(u - hx) < 3.5 && vb > headY + 2.7 && vb < headY + 4.1) {
              lum *= 0.78;
            }
            if (pose === 'groom' && res.dRaisedPaw < res.dMain) {
              lum = clamp(lum + 0.16, 0, 0.98);
            }
          } else if (pose === 'loaf') {
            const hx = res.hx;
            const hy = res.hy;
            const inEarL = sdTriangle(u, res.vb, hx - 3.0, hy - 1.8, hx - 3.4, hy - 4.7, hx - 1.4, hy - 2.6);
            const inEarR = sdTriangle(u, res.vb, hx + 2.9, hy - 1.8, hx + 3.3, hy - 4.7, hx + 1.4, hy - 2.6);
            if (inEarL < 0 || inEarR < 0) lum *= 0.58;
            if (Math.abs(u - hx) < 3.6 && res.vb > hy + 2.4 && res.vb < hy + 3.6) lum *= 0.78;
          } else if (pose === 'sleep') {
            const hx = res.hx;
            const hy = res.hy;
            const inEarL = sdTriangle(u, res.vb, hx - 2.3, hy - 2.0, hx - 2.0, hy - 4.2, hx - 0.8, hy - 2.5);
            const inEarR = sdTriangle(u, res.vb, hx + 1.0, hy - 2.3, hx + 2.3, hy - 4.1, hx + 2.7, hy - 2.0);
            if (inEarL < 0 || inEarR < 0) lum *= 0.58;
            if (res.dTail < 0.0 && res.dMain < 0.0) lum = clamp(lum + 0.14, 0, 0.96);
          } else if (pose === 'right' || pose === 'left') {
            const su = res.u;
            const vb = res.vb;

            if (res.dFarLegs < res.dNear) {
              lum *= 0.58;
            }

            if (sdTriangle(su, vb, 6.5, -12.6, 7.0, -14.9, 8.1, -12.9) < 0) {
              lum *= 0.58;
            }
          } else if (pose === 'up') {
            if (res.dTail < 0.0 && res.dMain < 0.0) {
              lum = clamp(lum + 0.16, 0, 0.96);
            }
          }

          const rIdx = Math.min(FUR_RAMP.length - 1, Math.floor(lum * FUR_RAMP.length));
          let ch = FUR_RAMP.charCodeAt(rIdx);
          // Slick vertical wet-fur streaks when soggy!
          if (wet > 0.35 && ((c + r) & 3) === 0 && lum < 0.72) {
            ch = lum > 0.48 ? 124 : 59; // '|' or ';'
          }
          this.plot(c, r, ch, lum * lumScale, z + 0.1);
        }
      }

      // Shimmering 2-row pool waterline collar hugging the swimming cat's submerged chest/waist!
      if (inPond) {
        const wlRow = Math.round(cat.y);
        const wlHalf = Math.round(clamp((pose === 'right' || pose === 'left' ? 9.2 : 6.4) * s, 5, 26));
        const cxR = Math.round(cx);
        for (let dc = -wlHalf; dc <= wlHalf; dc++) {
          const frac = Math.abs(dc) / Math.max(1, wlHalf);
          const wave = Math.sin(t * 5.2 + dc * 0.75);
          const ch = dc === -wlHalf ? 40 : dc === wlHalf ? 41 : (wave > 0.1 ? 126 : 45); // '(', ')', '~', '-'
          const wlLum = clamp(0.46 + (1 - frac * 0.42) * 0.38 + wave * 0.10, 0.34, 0.92);
          this.plot(cxR + dc, wlRow, ch, wlLum * lumScale, z + 0.30);
        }
        // Soft second submerged ripple ring right below the waterline
        const r2Half = Math.max(3, wlHalf - 2);
        for (let dc = -r2Half; dc <= r2Half; dc++) {
          const wave2 = Math.cos(t * 4.2 + dc * 0.65);
          const ch2 = dc === -r2Half ? 40 : dc === r2Half ? 41 : (wave2 > 0.25 ? 126 : 45);
          this.plot(cxR + dc, wlRow + 1, ch2, clamp(0.28 + wave2 * 0.10, 0.20, 0.46) * lumScale, z + 0.25);
        }
      }

      // EXPLICIT CRISP FACIAL FEATURES (guaranteed grid-aligned at every scale, zero weird blank cutouts!)
      const squishYDiv = inBoxSquish ? 1 + squishT * 0.26 : 1;
      const toC = (uVal) => Math.round(cx + uVal * s);
      const toR = (vVal) => Math.round(cy + ((vVal / squishYDiv) * s) / asp);

      const drawWhisker = (wu, wv, chCode) => {
        const wc = toC(wu);
        const wr = toR(wv);
        this.plot(wc, wr, chCode, 0.85 * lumScale, z + 0.14);
      };

      if (pose === 'sit' || pose === 'box' || pose === 'down' || pose === 'groom') {
        const gBob = pose === 'groom' ? groomWave * 0.45 : 0;
        const hx = pose === 'groom' ? groomSide * 0.45 : 0;
        const headY = (pose === 'sit' || pose === 'box' ? -13.9 : -13.6) - bob + gBob;
        const lookShift = typingBlend > 0.2 ? room.typing.lookX * 0.55 : (pose === 'sit' || pose === 'box' ? cat.lookX * 0.5 : 0);
        const eyeR = toR(headY - 0.15 + (typingBlend > 0.4 ? 0.35 : 0));
        const eyeLC = toC(hx - 1.85 + lookShift);
        const eyeRC = toC(hx + 1.85 + lookShift);
        const wideEyes = s >= 1.05;
        const tallEyes = s >= 1.65;

        const drawEye = (ec) => {
          if (isHappy) {
            this.plot(ec, eyeR, 94, 1.0, z + 0.22); // '^'
            if (tallEyes) this.plot(ec + 1, eyeR, 94, 1.0, z + 0.22);
          } else if (isBlinking || pose === 'groom') {
            this.plot(ec, eyeR, 45, 0.30, z + 0.22); // relaxed closed '-'
            if (wideEyes) this.plot(ec + 1, eyeR, 45, 0.30, z + 0.22);
          } else {
            // Glossy dark feline eye with crisp white catchlight glint (zero black void squares!)
            this.plot(ec, eyeR, 39, 1.0, z + 0.22); // bright catchlight '\''
            if (wideEyes) {
              this.plot(ec + 1, eyeR, 111, 0.22, z + 0.22); // soft dark iris 'o'
            }
            if (tallEyes) {
              this.plot(ec, eyeR + 1, 111, 0.22, z + 0.22);
              this.plot(ec + 1, eyeR + 1, 58, 0.22, z + 0.22);
            }
          }
        };

        drawEye(wideEyes ? eyeLC - 1 : eyeLC);
        drawEye(eyeRC);

        const noseC = toC(hx);
        const noseR = toR(headY + 1.35);
        this.plot(noseC, noseR, 118, 0.32, z + 0.22);
        if (s >= 1.55) {
          this.plot(noseC, noseR + 1, 119, 0.42, z + 0.22);
        }

        const wy = headY + 1.1;
        const wx = 4.9 + chonk * 0.2;
        [-1, 1].forEach((side) => {
          drawWhisker(hx + side * (wx + 0.4), wy - 0.4, 45);
          drawWhisker(hx + side * (wx + 1.7), wy - 0.7, 45);
          drawWhisker(hx + side * (wx + 0.5), wy + 0.5, 45);
          drawWhisker(hx + side * (wx + 1.8), wy + 0.8, side > 0 ? 92 : 47);
        });
      } else if (pose === 'loaf') {
        const hx = 4.6 + chonk * 0.2;
        const hy = -8.0 - loafBreathe * 0.45;
        const lookShift = cat.lookX * 0.45;
        const eyeR = toR(hy - 0.15);
        const eyeLC = toC(hx - 1.7 + lookShift);
        const eyeRC = toC(hx + 1.7 + lookShift);
        const wideEyes = s >= 1.05;

        const drawLoafEye = (ec) => {
          if (isHappy) {
            this.plot(ec, eyeR, 94, 1.0, z + 0.22);
          } else if (isBlinking || Math.sin(t * 0.9) > 0.65) {
            this.plot(ec, eyeR, 45, 0.28, z + 0.22);
            if (wideEyes) this.plot(ec + 1, eyeR, 45, 0.28, z + 0.22);
          } else {
            this.plot(ec, eyeR, 39, 1.0, z + 0.22);
            if (wideEyes) this.plot(ec + 1, eyeR, 111, 0.22, z + 0.22);
          }
        };
        drawLoafEye(wideEyes ? eyeLC - 1 : eyeLC);
        drawLoafEye(eyeRC);

        this.plot(toC(hx), toR(hy + 1.25), 118, 0.26, z + 0.22);
        const wx = 4.6 + chonk * 0.18;
        [-1, 1].forEach((side) => {
          drawWhisker(hx + side * (wx + 0.3), hy + 0.8, 45);
          drawWhisker(hx + side * (wx + 1.5), hy + 0.6, 45);
          drawWhisker(hx + side * (wx + 0.4), hy + 1.6, side > 0 ? 92 : 47);
        });
      } else if (pose === 'sleep') {
        const hx = 4.6 + chonk * 0.2;
        const hy = -3.7 - sleepBreathe * 0.25;
        const eyeR = toR(hy - 0.1);
        const eyeLC = toC(hx - 1.55);
        const eyeRC = toC(hx + 1.55);
        const wideEyes = s >= 1.05;
        const chEye = isHappy ? 94 : 45; // '^' if purring in sleep, peaceful '-' closed eyes otherwise!
        const lumEye = isHappy ? 1.0 : 0.22;
        this.plot(wideEyes ? eyeLC - 1 : eyeLC, eyeR, chEye, lumEye, z + 0.22);
        this.plot(eyeRC, eyeR, chEye, lumEye, z + 0.22);
        if (wideEyes) {
          this.plot(eyeLC, eyeR, chEye, lumEye, z + 0.22);
          this.plot(eyeRC + 1, eyeR, chEye, lumEye, z + 0.22);
        }
        this.plot(toC(hx), toR(hy + 1.15), 118, 0.26, z + 0.22);
        drawWhisker(hx + 4.3, hy + 0.7, 45);
        drawWhisker(hx + 5.4, hy + 0.5, 45);
      } else if (pose === 'right' || pose === 'left') {
        const eyeC = toC(sideDir * 9.3);
        const eyeR = toR(-10.5 - bob);
        if (isHappy) {
          this.plot(eyeC, eyeR, 94, 1.0, z + 0.22);
        } else if (isBlinking) {
          this.plot(eyeC, eyeR, 45, 0.25, z + 0.22);
        } else {
          this.plot(eyeC, eyeR, 39, 0.95, z + 0.22);
          if (s >= 1.25) {
            this.plot(eyeC - sideDir, eyeR, 111, 0.22, z + 0.22);
          }
        }

        const noseC = toC(sideDir * 11.9);
        const noseR = toR(-9.6 - bob);
        this.plot(noseC, noseR, 46, 0.22, z + 0.22);

        const wy = -9.4 - bob;
        drawWhisker(sideDir * 12.6, wy - 0.4, 45);
        drawWhisker(sideDir * 13.9, wy - 0.6, 45);
        drawWhisker(sideDir * 12.6, wy + 0.5, sideDir > 0 ? 92 : 47);
      }

      // Floating cute "meow" / "crunch!" / "*bigger!*" bubble rising cleanly above ears
      if (cat.meowTimer > 0) {
        const progress = 1 - cat.meowTimer / 1.85;
        const fade = progress < 0.2 ? progress / 0.2 : clamp((1 - progress) / 0.35, 0, 1);
        const topHeadV = (pose === 'sleep' ? -11.0 : pose === 'loaf' ? -15.5 : pose === 'right' || pose === 'left' ? -17.0 : -21.2) * s;
        const floatY = Math.round(cy + topHeadV / asp - 1.5 - progress * 3.5);
        const text = cat.meowText;
        const startX = Math.round(cx) - Math.floor(text.length / 2);
        for (let i = -1; i <= text.length; i++) {
          this.clearHaloCell(startX + i, floatY, 9000);
        }
        for (let i = 0; i < text.length; i++) {
          this.plot(startX + i, floatY, text.charCodeAt(i), clamp(fade * 0.98, 0.15, 1.0), 9001);
        }
      }
    }

    // MONOCHROME ASCII QWERTY MECHANICAL KEYBOARD (exact canonical coordinates matching paw strikes!)
    renderKeyboard(room) {
      const kb = room.keyboard;
      const blend = room.typingBlend;
      const kbZ = 5000;
      const slideY = Math.round((1 - blend) * 6);
      const top = kb.top + slideY;
      const left = kb.left;
      const width = kb.width;
      const height = kb.height;

      // Solid dark clearing right under and around the keyboard so every keycap is razor-sharp!
      for (let r = top - 1; r <= top + height + 1; r++) {
        for (let c = left - 2; c <= left + width + 1; c++) {
          this.clearHaloCell(c, r, kbZ - 5);
        }
      }

      const frameLum = clamp(0.62 * blend, 0.1, 0.68);
      // Top & bottom beveled keyboard chassis
      for (let c = left; c < left + width; c++) {
        const topCh = c === left ? 46 : c === left + width - 1 ? 46 : 45; // '.----.'
        const botCh = c === left ? 39 : c === left + width - 1 ? 39 : 45; // "'----'"
        this.plot(c, top, topCh, frameLum, kbZ);
        this.plot(c, top + height - 1, botCh, frameLum * 0.9, kbZ);
        // Subtle 3D bottom lip shadow
        if (c > left && c < left + width - 1) {
          this.plot(c, top + height, 61, frameLum * 0.35, kbZ); // '=' base bezel
        }
      }
      for (let r = top + 1; r < top + height - 1; r++) {
        this.plot(left, r, 124, frameLum, kbZ); // '|'
        this.plot(left + width - 1, r, 124, frameLum, kbZ);
        // Soft dim separator rules between keycap rows
        if ((r - top) % 2 === 0) {
          for (let c = left + 1; c < left + width - 1; c++) {
            this.plot(c, r, 46, frameLum * 0.18, kbZ);
          }
        }
      }

      // Render every individual keycap at its exact canonical coordinate!
      const active = room.typing.activeKeys;
      const keys = kb.keys;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const kr = k.row + slideY;
        const act = active[k.id] || 0;
        const pressed = act > 0;
        const keyLum = pressed ? 1.0 : clamp(0.76 * blend, 0.15, 0.82);
        const bracketLum = pressed ? 1.0 : clamp(0.38 * blend, 0.1, 0.44);

        const openCh = pressed ? 35 : 91; // '#' flash when struck, '[' idle
        const closeCh = pressed ? 35 : 93; // '#' flash when struck, ']' idle

        this.plot(k.col, kr, openCh, bracketLum, kbZ + 1);
        this.plot(k.col + k.w - 1, kr, closeCh, bracketLum, kbZ + 1);

        // Fill inner keycap text centered inside [ ... ]
        const innerW = k.w - 2;
        const lbl = k.label;
        const padLeft = Math.floor((innerW - lbl.length) / 2);
        for (let j = 0; j < innerW; j++) {
          const idx = j - padLeft;
          const ch = idx >= 0 && idx < lbl.length ? lbl.charCodeAt(idx) : (pressed ? 61 : 32);
          const l = idx >= 0 && idx < lbl.length ? keyLum : (pressed ? 0.55 : 0.08);
          this.plot(k.col + 1 + j, kr, ch, l, kbZ + 1);
        }

        // Visual key depression highlight underneath active key
        if (pressed) {
          for (let j = 0; j < k.w; j++) {
            this.plot(k.col + j, kr + 1, 61, clamp(act * 3.8, 0.25, 0.92), kbZ + 2);
          }
        }
      }
    }

    // ARTICULATED FURRY CAT ARMS & PAWS REACHING RIGHT ONTO THE EXACT STRUCK KEYCAP!
    renderTypingPaws(room) {
      const blend = room.typingBlend;
      if (blend < 0.15) return;

      const cat = room.cat;
      const asp = this.aspect;
      const compact = this.cols < 110;
      const uUnit = room.getBaseUnitScale();
      const s = cat.scale * (compact ? 1.14 : uUnit * 1.12);
      const kb = room.keyboard;
      const slideY = (1 - blend) * 6;
      const pawZ = 5100;

      // Shoulder origins on the cat's front chest
      const lShX = cat.x - 3.4 * s;
      const lShY = cat.y - (5.6 * s) / asp;
      const rShX = cat.x + 3.4 * s;
      const rShY = cat.y - (5.6 * s) / asp;

      const drawArmAndPaw = (shX, shY, paw) => {
        const px = paw.x;
        const py = paw.y + slideY + (paw.strike > 0.15 ? 0.25 : -0.35);
        const pressSquish = paw.strike * 0.45;

        // Bounding box covering shoulder -> paw target in grid coordinates
        const padX = Math.ceil(4.5 * uUnit);
        const padY = Math.ceil(3.5 * uUnit);
        const x0 = Math.max(0, Math.floor(Math.min(shX, px) - padX));
        const x1 = Math.min(this.cols - 1, Math.ceil(Math.max(shX, px) + padX));
        const y0 = Math.max(0, Math.floor(Math.min(shY, py) - padY));
        const y1 = Math.min(this.rows - 1, Math.ceil(Math.max(shY, py) + padY));

        // Convert endpoints to aspect-corrected coordinates for undistorted cylindrical furry limbs
        const ax = shX;
        const ay = shY * asp;
        const bx = px;
        const by = py * asp;
        const armRa = 1.45 * uUnit * Math.min(1.4, cat.scale * 0.9 + 0.1);
        const armRb = (1.18 + pressSquish * 0.25) * uUnit;
        const pawRx = (1.65 + pressSquish * 0.55) * uUnit;
        const pawRy = (1.15 + pressSquish * 0.25) * uUnit;

        for (let r = y0; r <= y1; r++) {
          const vy = r * asp;
          for (let c = x0; c <= x1; c++) {
            const dArm = sdCapsule(c, vy, ax, ay, bx, by, armRa, armRb);
            const dPaw = sdEllipse(c, vy, bx, by, pawRx, pawRy);
            const d = smin(dArm, dPaw, 0.55);

            // Crisp 1-cell dark cutout border so the cat's paw reads razor-sharp over the white keys!
            if (d >= 0.0 && d < 0.95) {
              this.clearHaloCell(c, r, pawZ - 2);
              continue;
            }
            if (d >= 0.95) continue;

            // 3D sculpted shading along the arm & paw pad
            const along = clamp(((c - ax) * (bx - ax) + (vy - ay) * (by - ay)) / (Math.pow(bx - ax, 2) + Math.pow(by - ay, 2) + 1e-4), 0, 1);
            const isPawTip = dPaw < 0.15;
            const edgeShade = clamp(-d / 1.5, 0.2, 1.0);
            const lum = clamp((isPawTip ? 0.84 + paw.strike * 0.16 : 0.62 + edgeShade * 0.28 + along * 0.08) * blend, 0.25, 1.0);
            const rIdx = Math.min(FUR_RAMP.length - 1, Math.floor(lum * FUR_RAMP.length));
            const ch = isPawTip && Math.abs(c - Math.round(px)) <= 1 && r === Math.round(py) ? 87 : FUR_RAMP.charCodeAt(rIdx);
            this.plot(c, r, ch, lum, pawZ + (isPawTip ? 2 : 0));
          }
        }
      };

      drawArmAndPaw(lShX, lShY, room.typing.leftPaw);
      drawArmAndPaw(rShX, rShY, room.typing.rightPaw);
    }

    renderPurrSparks(room) {
      const sparks = room.purrSparks;
      for (let i = 0; i < sparks.length; i++) {
        const sp = sparks[i];
        const prog = sp.life / sp.maxLife;
        const fade = prog < 0.2 ? prog / 0.2 : clamp((1 - prog) / 0.45, 0, 1);
        const text = sp.label;
        const sx = Math.round(sp.x) - Math.floor(text.length / 2);
        const sy = Math.round(sp.y);
        for (let k = 0; k < text.length; k++) {
          this.clearHaloCell(sx + k, sy, 8600);
          this.plot(sx + k, sy, text.charCodeAt(k), clamp(fade * 0.9, 0.12, 0.95), 8601);
        }
      }
    }

    renderSleepZs(room) {
      const zs = room.sleepZs;
      for (let i = 0; i < zs.length; i++) {
        const sz = zs[i];
        const prog = sz.life / sz.maxLife;
        const fade = prog < 0.2 ? prog / 0.2 : clamp((1 - prog) / 0.45, 0, 1);
        const c = Math.round(sz.x);
        const r = Math.round(sz.y);
        for (let dc = -1; dc <= 1; dc++) {
          this.clearHaloCell(c + dc, r, 8650);
        }
        this.plot(c, r, sz.ch, clamp(fade * 0.92, 0.12, 0.96), 8651);
      }
    }

    renderLeaves(room) {
      const t = room.time;
      for (let i = 0; i < room.leaves.length; i++) {
        const lf = room.leaves[i];
        const c = Math.round(lf.x);
        const r = Math.round(lf.y);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        const fade = 1 - lf.life / lf.maxLife;
        const spin = Math.sin(t * 6.5 + lf.phase);
        const ch = spin > 0.3 ? 47 : spin < -0.3 ? 92 : 126;
        // Behind cat/entities (z = -100) so falling leaves never put dark dots on the cat!
        this.plot(c, r, ch, clamp(fade * 0.78, 0.14, 0.86), -100);
      }
    }

    renderCrumbs(room) {
      for (let i = 0; i < room.crumbs.length; i++) {
        const cr = room.crumbs[i];
        const c = Math.round(cr.x);
        const r = Math.round(cr.y);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        const fade = 1 - cr.life / cr.maxLife;
        this.plot(c, r, cr.ch, clamp(fade * 0.95, 0.15, 1.0), 8500);
      }
    }

    renderDroplets(room) {
      for (let i = 0; i < room.droplets.length; i++) {
        const dr = room.droplets[i];
        const c = Math.round(dr.x);
        const r = Math.round(dr.y);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        const fade = 1 - dr.life / dr.maxLife;
        this.plot(c, r, dr.ch, clamp(fade * 0.92, 0.25, 0.96), 8520);
      }
    }

    // Serene small still pond with calm dark-ink water shimmer and expanding concentric ripples
    renderPond(room) {
      const p = room.pond;
      const t = room.time;
      const ripples = room.pondRipples;
      const x0 = Math.max(0, Math.floor(p.x - p.rx - 2));
      const x1 = Math.min(this.cols - 1, Math.ceil(p.x + p.rx + 2));
      const y0 = Math.max(0, Math.floor(p.y - p.ry - 2));
      const y1 = Math.min(this.rows - 1, Math.ceil(p.y + p.ry + 2));

      for (let r = y0; r <= y1; r++) {
        const dy = (r - p.y) / p.ry;
        for (let c = x0; c <= x1; c++) {
          const dx = (c - p.x) / p.rx;
          const d2 = dx * dx + dy * dy;
          if (d2 > 1.18) continue;

          // Subtle soft stone/reed bank rim around the water
          if (d2 > 0.92) {
            const bankLum = clamp(0.32 - dx * 0.08 - dy * 0.06, 0.18, 0.44);
            const ch = Math.abs(dy) > Math.abs(dx) ? 45 : (dx < 0 ? 40 : 41); // '-', '(', ')'
            this.plot(c, r, ch, bankLum, -600);
            continue;
          }

          // Check concentric expanding water ripples inside the pond
          let rippleHit = 0;
          let rippleDir = 0;
          for (let i = 0; i < ripples.length; i++) {
            const rp = ripples[i];
            const rdx = c - rp.x;
            const rdy = (r - rp.y) * 2.4;
            const rd = Math.hypot(rdx, rdy);
            const diff = Math.abs(rd - rp.r);
            if (diff < 0.9) {
              const fade = 1 - rp.age / rp.maxAge;
              const hit = (1 - diff / 0.9) * fade;
              if (hit > rippleHit) {
                rippleHit = hit;
                rippleDir = Math.abs(rdx) > Math.abs(rdy) ? (rdx < 0 ? -1 : 1) : 0;
              }
            }
          }

          if (rippleHit > 0.18) {
            const ch = rippleDir < 0 ? 40 : rippleDir > 0 ? 41 : 126; // '(', ')', '~'
            this.plot(c, r, ch, clamp(0.35 + rippleHit * 0.52, 0.28, 0.88), -590);
          } else {
            // Calm dark-ink water with subtle drifting moonlight/daylight shimmer
            const shimmer = Math.sin(c * 0.45 + t * 1.4 + r * 1.9);
            const isGlint = shimmer > 0.72 && (c + r) % 2 === 0;
            const lum = isGlint ? 0.34 : clamp(0.11 + (1 - d2) * 0.06, 0.09, 0.20);
            const ch = isGlint ? 126 : (shimmer > 0.1 ? 45 : 46); // '~', '-', '.'
            this.plot(c, r, ch, lum, -595);
          }
        }
      }
    }

    // Subtle local-time night sky: delicate crescent moon in upper-right + gentle twinkling stars
    renderSkyMoonStars(room) {
      if (!room.weather.isNight) return;
      const t = room.time;
      const compact = this.cols < 110;
      const mx = Math.round(this.cols * (compact ? 0.86 : 0.90));
      const my = Math.round(this.rows * (compact ? 0.09 : 0.11));

      const moon = [
        ' .-',
        '/ (',
        '\\ (',
        ' \'-',
      ];
      for (let r = 0; r < moon.length; r++) {
        for (let c = 0; c < moon[r].length; c++) {
          const code = moon[r].charCodeAt(c);
          if (code === 32) continue;
          const lum = code === 40 ? 0.44 : 0.78;
          this.plot(mx + c, my + r, code, lum, -400);
        }
      }

      // Soft twinkling sky stars in the upper corners (never over header or cat!)
      const starCoords = compact
        ? [[0.10, 0.07], [0.18, 0.16], [0.80, 0.16], [0.92, 0.18]]
        : [[0.08, 0.09], [0.14, 0.17], [0.22, 0.07], [0.78, 0.09], [0.84, 0.18], [0.94, 0.20]];
      for (let i = 0; i < starCoords.length; i++) {
        const sc = Math.round(this.cols * starCoords[i][0]);
        const sr = Math.round(this.rows * starCoords[i][1]);
        const tw = 0.5 + 0.5 * Math.sin(t * (1.3 + i * 0.35) + i * 2.1);
        const ch = tw > 0.78 ? 43 : 46; // '+' or '.'
        this.plot(sc, sr, ch, clamp(0.22 + tw * 0.44, 0.18, 0.68), -400);
      }
    }

    // Warm pulsing monochrome fireflies at night (strictly behind cat so zero dots ever overlap cat!)
    renderFireflies(room) {
      const flies = room.fireflies;
      if (flies.length === 0) return;
      const t = room.time;
      for (let i = 0; i < flies.length; i++) {
        const ff = flies[i];
        const c = Math.round(ff.x);
        const r = Math.round(ff.y);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.4 + ff.phase);
        if (pulse < 0.2) continue;
        const ch = pulse > 0.72 ? 42 : 46; // '*' or '.'
        this.plot(c, r, ch, clamp(pulse * 0.72, 0.18, 0.76), -150);
      }
    }

    // Ultra-gentle occasional passing monochrome drizzle (strictly behind cat!)
    renderRain(room) {
      const drops = room.rainDrops;
      if (drops.length === 0 || room.weather.rainIntensity <= 0.03) return;
      const lum = clamp(0.32 * room.weather.rainIntensity, 0.08, 0.36);
      for (let i = 0; i < drops.length; i++) {
        const rd = drops[i];
        const c = Math.round(rd.x);
        const r = Math.round(rd.y);
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;
        this.plot(c, r, i % 3 === 0 ? 39 : 47, lum, -120); // "'" or '/'
      }
    }

    // Subtle lazily floating dust motes inside the warm diagonal sunbeam (behind cat at z = -200!)
    renderSunbeamMotes(room) {
      if (room.weather.rainIntensity > 0.35) return;
      const sb = room.sunbeam;
      const t = room.time;
      for (let i = 0; i < 6; i++) {
        const phase = (t * 0.16 + i * 0.173) % 1.0;
        const ang = i * 2.1 + t * 0.4;
        const mx = Math.round(sb.x + Math.cos(ang) * sb.rx * 0.55 - (phase - 0.5) * 6);
        const my = Math.round(sb.y + Math.sin(ang * 0.8) * sb.ry * 0.65 - phase * 4.5);
        const fade = Math.sin(phase * Math.PI);
        if (fade < 0.15) continue;
        const ch = i % 2 === 0 ? 46 : 42; // '.' or subtle '*'
        this.plot(mx, my, ch, clamp(fade * 0.52, 0.12, 0.55), -200);
      }
    }

    // Delicate fluttering monochrome meadow moth
    renderMoth(room) {
      const m = room.moth;
      if (!m.active) return;
      const c = Math.round(m.x);
      const r = Math.round(m.y);
      if (c < 1 || c >= this.cols - 1 || r < 1 || r >= this.rows - 1) return;
      const prog = m.age / m.maxAge;
      const fade = prog < 0.1 ? prog / 0.1 : clamp((1 - prog) / 0.15, 0, 1);
      const flap = Math.sin(room.time * 24 + m.phase);
      const lum = clamp(0.88 * fade, 0.15, 0.96);
      if (flap > 0.15) {
        this.plot(c - 1, r, 40, lum * 0.85, 8700); // '('
        this.plot(c, r, 42, lum, 8701);            // '*'
        this.plot(c + 1, r, 41, lum * 0.85, 8700); // ')'
      } else {
        this.plot(c, r, flap < -0.3 ? 118 : 94, lum, 8701);
      }
    }

    flushWebGL() {
      const gl = this.gl;
      const total = this.cols * this.rows;
      const charBuf = this.charBuf;
      const lumBuf = this.lumBuf;
      const data = this.cellTexData;

      for (let i = 0; i < total; i++) {
        const o = i << 2;
        const code = charBuf[i];
        data[o] = code > 32 && code <= 126 ? code - FIRST_CHAR : 0;
        data[o + 1] = (lumBuf[i] * 255) | 0;
      }

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, data);

      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    flushCanvas2D() {
      const ctx = this.ctx2d;
      const cw = this.pxCellW;
      const ch = this.pxCellH;
      const ox = this.offsetX;
      const oy = this.offsetY;
      const cols = this.cols;
      const rows = this.rows;
      const charBuf = this.charBuf;
      const lumBuf = this.lumBuf;
      const fontPx = Math.round(this.fontSize * this.dpr);

      ctx.fillStyle = '#050506';
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.font = `600 ${fontPx}px 'JetBrains Mono', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      let lastShade = -1;
      for (let r = 0; r < rows; r++) {
        const dy = oy + r * ch + ch * 0.53;
        const rowOff = r * cols;
        for (let c = 0; c < cols; c++) {
          const idx = rowOff + c;
          const code = charBuf[idx];
          if (code <= 32 || code > 126) continue;
          const lum = lumBuf[idx];
          if (lum < 0.04) continue;
          const shade = Math.round(lerp(22, 255, Math.pow(lum, 1.12))) & 248;
          if (shade !== lastShade) {
            ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
            lastShade = shade;
          }
          ctx.fillText(String.fromCharCode(code), ox + c * cw + cw * 0.5, dy);
        }
      }
    }
  }

  global.AsciiRenderer = AsciiRenderer;
})(window);
