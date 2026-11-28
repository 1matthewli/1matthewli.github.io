// Deterministic fast 2D noise and math utilities for the ASCII world engine
(function (global) {
  'use strict';

  function fract(x) {
    return x - Math.floor(x);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  }

  // Fast deterministic 2D integer hash returning [0, 1)
  function hash2i(ix, iy) {
    let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  // Smooth 2D value noise in [0, 1]
  function valueNoise2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const a = hash2i(ix, iy);
    const b = hash2i(ix + 1, iy);
    const c = hash2i(ix, iy + 1);
    const d = hash2i(ix + 1, iy + 1);

    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  // Fast 2-octave FBM in [0, 1]
  function fbm2(x, y) {
    return valueNoise2D(x, y) * 0.667 + valueNoise2D(x * 2.03 + 17.1, y * 2.01 - 11.7) * 0.333;
  }

  // 3-octave FBM for richer organic silhouettes
  function fbm3(x, y) {
    return (
      valueNoise2D(x, y) * 0.55 +
      valueNoise2D(x * 2.04 + 13.7, y * 2.02 - 9.3) * 0.30 +
      valueNoise2D(x * 4.07 - 21.4, y * 4.03 + 7.9) * 0.15
    );
  }

  global.AsciiMath = {
    fract,
    clamp,
    lerp,
    smoothstep,
    hash2i,
    valueNoise2D,
    fbm2,
    fbm3,
  };
})(window);
