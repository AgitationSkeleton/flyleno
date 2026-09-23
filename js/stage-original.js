// An ORIGINAL, procedurally generated talk-show stage in the spirit of the "TUURD Talk" set.
//
// Everything here is built from three.js primitives and canvas textures drawn by this file.
// No meshes, textures or images from any game are loaded. Only the LAYOUT (positions, sizes,
// seat-row coordinates) was measured from the reference scene, so audience markers and the host
// spot stay compatible with js/stage.js (see assets/original-stage-notes.md).
//
//   const { root, markers, ground, markerGroup, screens } = await loadOriginalStage(scene, { lite })
//
// Coordinates: right-handed, +Y up, metres. The stage faces +Z toward the audience.
// The speaking platform is centred at (0, 0, -7.19) with radius 8.84 m, top at y = 1.167.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

// Droid Sans Bold, (c) 2008 The Android Open Source Project, Apache License 2.0
// (three.js repo: examples/fonts/droid/NOTICE). Loaded from the CDN at runtime, not bundled.
const FONT_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/examples/fonts/droid/droid_sans_bold.typeface.json';

// ------------------------------------------------------------------ layout (measured, metres)
const FLOOR_Y = 0.2;
const PLATFORM = { cx: 0, cz: -7.19, radii: [8.84, 8.34, 7.84, 7.34], tops: [0.43, 0.675, 0.92, 1.167] };
const PLATFORM_TOP = 1.167;
const HOST = [0.15, PLATFORM_TOP, -4.94];
const GUEST = [2.43, PLATFORM_TOP, -7.78];
const CAMERA = { position: [-0.701, 9.52, 30.45], forward: [0.0288, -0.1756, -0.984] };

// 18 rows x 20 seats: [x, y, z] of seat 0 and the facing yaw (deg; 180 = facing -Z, the stage).
// Seats run along the row's local +X (= (cos yaw, 0, -sin yaw)) at the SEAT_OFFSETS below.
const ROWS = [
  [7.24, 0.2014, 5.419, 180], [7.24, 0.2014, 7.669, 180], [7.24, 0.2014, 10.229, 180],
  [7.24, 0.2014, 13.509, 180], [7.24, 0.2014, 16.349, 180], [7.24, 0.2014, 19.979, 180],
  [-9.585, 0.2014, 4.511, 119.418], [-11.615, 0.2014, 7.641, 119.418], [-13.635, 0.2014, 11.471, 119.418],
  [16.822, 0.2014, -8.520, -123.051], [18.892, 0.2014, -5.270, -123.051], [20.292, 0.2014, -0.930, -123.051],
  [7.13, 2.1964, 26.549, 180], [7.13, 4.1214, 30.799, 180],
  [23.882, 2.2014, 3.280, -123.051], [26.962, 4.1014, 5.280, -123.051],
  [-17.745, 2.2114, 16.481, 119.418], [-20.725, 4.1114, 18.211, 119.418],
];
const SEAT_OFFSETS = [0, 0.773, 1.574, 2.383, 3.141, 3.939, 4.715, 5.523, 6.317, 7.082,
  7.87, 8.64, 9.482, 10.249, 11.029, 11.819, 12.579, 13.386, 14.155, 14.954];
const ROW_MID = (SEAT_OFFSETS[0] + SEAT_OFFSETS[19]) / 2;
// Raised seating sections: [front row index, back row index]
const TIER_SECTIONS = [[12, 13], [14, 15], [16, 17]];
const TIER_TOP = 5.97;

// Sittable toilets (a running gag of the show): seat point + facing (x, z) direction.
const TOILETS = [
  [-31.914, 7.220, 5.921, -0.2783, -0.9605], [9.879, 5.065, 29.781, 0.754, -0.6569],
  [-8.372, 7.716, 33.736, 0.9999, 0.0108], [-22.159, 7.421, 22.401, 0.1922, 0.9813],
  [8.459, 7.716, 33.900, -0.9756, 0.2195], [30.802, 7.781, 6.126, -0.2001, 0.9798],
  [-0.584, 1.759, -5.772, 0.0123, 0.9999], [9.879, 3.105, 26.606, 0.754, -0.6569],
  [21.179, 7.781, 20.204, 0.481, -0.8767], [-10.066, 3.115, 26.450, -0.6356, -0.772],
  [-10.066, 5.065, 30.210, -0.6356, -0.772],
];
const TOILET_SEAT_H = 0.62, TOILET_SEAT_FWD = 0.26; // at scale 1

// Open floor spots in the aisles (for extras / random walkers).
const SPAWNS = [[7.9, 12.4], [-8.6, 12.1], [0.9, 24.2], [12.0, -11.2], [14.9, 22.5],
  [-12.5, -9.5], [15.4, -4.4], [-20.4, -7.2], [1.7, 23.1], [4.0, -21.0]];

// ------------------------------------------------------------------ small helpers
const DEG = Math.PI / 180;
const _o = new THREE.Object3D();
function M(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _o.position.set(x, y, z);
  _o.rotation.set(rx, ry, rz, 'YXZ');
  _o.scale.set(sx, sy, sz);
  _o.updateMatrix();
  return _o.matrix.clone();
}
function rng(seed) { // mulberry32
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collects geometries (baked to world space) and merges them into one mesh per material. */
class Bin {
  constructor(material, colors = false) { this.material = material; this.colors = colors; this.list = []; }
  add(geo, matrix, color) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (matrix) g.applyMatrix4(matrix);
    if (this.colors) {
      const c = new THREE.Color(color ?? 0xffffff), n = g.attributes.position.count, a = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
    }
    g.clearGroups();
    this.list.push(g);
    return this;
  }
  build(name) {
    if (!this.list.length) return null;
    const mesh = new THREE.Mesh(mergeGeometries(this.list, false), this.material);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.receiveShadow = true;
    this.list.forEach((g) => g.dispose());
    return mesh;
  }
}

/** Rewrites UVs from world XZ (for floors / tops) so textures tile at a fixed metric scale. */
function planarUV(geo, scale) {
  const p = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / scale, p.getZ(i) / scale);
  uv.needsUpdate = true;
  return geo;
}

// ------------------------------------------------------------------ procedural textures
function canvasTexture(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function noiseFill(ctx, w, h, seed, fn) {
  const img = ctx.createImageData(w, h), d = img.data, r = rng(seed);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const [R, G, B] = fn(x, y, r);
    const i = (y * w + x) * 4;
    d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
// Red looped-pile carpet: fine per-pixel noise plus a few brighter fibre tufts.
const carpetTexture = () => canvasTexture(256, 256, (ctx, w, h) => {
  noiseFill(ctx, w, h, 11, (x, y, r) => {
    const k = 0.62 + 0.5 * r() + (r() < 0.04 ? 0.35 : 0) + 0.08 * Math.sin((x + y) * 0.9);
    return [Math.min(255, 150 * k), 18 * k, 22 * k];
  });
});
// Dark studio floor: charcoal speckle with soft blotches.
const floorTexture = () => canvasTexture(512, 512, (ctx, w, h) => {
  noiseFill(ctx, w, h, 23, (x, y, r) => {
    const blot = 0.5 + 0.25 * Math.sin(x * 0.037) * Math.sin(y * 0.029) + 0.25 * Math.sin((x + 2 * y) * 0.011);
    const v = 30 + 22 * r() * r() + 10 * blot;
    return [v, v, v * 1.04];
  });
});
// Red velvet: 8 soft vertical folds per tile, matching the geometric folds of the curtain meshes.
const FOLDS_PER_TILE = 8, FOLD_W = 1.2; // metres per fold
const curtainTexture = () => canvasTexture(512, 128, (ctx, w, h) => {
  const streak = new Float32Array(w), r0 = rng(5);
  for (let x = 0; x < w; x++) streak[x] = 0.9 + 0.2 * r0();
  noiseFill(ctx, w, h, 7, (x, y, r) => {
    const ph = (x / w) * FOLDS_PER_TILE * Math.PI * 2;
    const fold = 0.5 + 0.5 * Math.sin(ph);
    const k = (0.25 + 0.85 * Math.pow(fold, 1.4) + 0.12 * Math.pow(Math.max(0, Math.sin(ph * 2 + 1)), 6)) * streak[x] * (0.93 + 0.07 * r());
    return [Math.min(255, 190 * k), 12 * k, 22 * k];
  });
});
// Riser carpet (seating tiers): deep navy with speckle.
const tierTexture = () => canvasTexture(256, 256, (ctx, w, h) => {
  noiseFill(ctx, w, h, 31, (x, y, r) => {
    const k = 0.7 + 0.45 * r();
    return [30 * k, 34 * k, 50 * k];
  });
});

// ------------------------------------------------------------------ screens (animated canvases)
const LOGO_FONT = '"Arial Black", "Arial Bold", Arial, Helvetica, sans-serif';
function drawLogo(ctx, cx, cy, size, t) {
  ctx.save();
  ctx.translate(cx, cy);
  const s = 1 + 0.025 * Math.sin(t * 2.1);
  ctx.scale(s, s);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `900 ${size}px ${LOGO_FONT}`;
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.05;
  ctx.lineWidth = size * 0.1;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText('TUURD', 0, 0);
  ctx.shadowColor = 'transparent';
  const g = ctx.createLinearGradient(0, -size * 0.8, 0, 0);
  g.addColorStop(0, '#ff6a3a'); g.addColorStop(1, '#e0120f');
  ctx.fillStyle = g;
  ctx.fillText('TUURD', 0, 0);
  ctx.font = `italic 900 ${size * 0.56}px ${LOGO_FONT}`;
  ctx.textAlign = 'right';
  ctx.lineWidth = size * 0.07;
  ctx.strokeStyle = '#1b0b44';
  ctx.strokeText('Talk', size * 1.55, size * 0.52);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('Talk', size * 1.55, size * 0.52);
  ctx.restore();
}
function drawRays(ctx, cx, cy, r, n, t, alpha) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(t);
  ctx.fillStyle = `rgba(255,255,255,${alpha})`;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, r, a, a + Math.PI / n);
    ctx.fill();
  }
  ctx.restore();
}
const STARS = Array.from({ length: 60 }, (_, i) => { const r = rng(100 + i); return [r(), r(), r() * 6.28, 0.5 + r()]; });
function drawStars(ctx, w, h, t) {
  for (const [x, y, ph, s] of STARS) {
    const k = Math.max(0, Math.sin(t * 2.5 * s + ph));
    if (k < 0.2) continue;
    ctx.fillStyle = `rgba(255,255,255,${k * 0.9})`;
    const R = (2 + 4 * k) * (w / 1024);
    ctx.beginPath();
    ctx.moveTo(x * w, y * h - R * 2); ctx.lineTo(x * w + R * 0.5, y * h); ctx.lineTo(x * w, y * h + R * 2); ctx.lineTo(x * w - R * 0.5, y * h);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x * w - R * 2, y * h); ctx.lineTo(x * w, y * h + R * 0.5); ctx.lineTo(x * w + R * 2, y * h); ctx.lineTo(x * w, y * h - R * 0.5);
    ctx.closePath(); ctx.fill();
  }
}
const TICKER = '  TUURD TALK  •  LIVE FROM STUDIO T  •  TONIGHT: A VERY SPECIAL HOST  •  PLEASE APPLAUD  •  NO HECKLING  •  ';

function drawBigScreen(ctx, w, h, t) {
  const scene = Math.floor(t / 14) % 3;
  const a = t * 0.2;
  // background sweep: violet -> crimson -> orange
  const g = ctx.createLinearGradient(w * (0.5 + 0.5 * Math.sin(a)), 0, w * (0.5 - 0.5 * Math.sin(a)), h);
  g.addColorStop(0, '#2a0f7a'); g.addColorStop(0.5, '#b0102c'); g.addColorStop(1, '#ff4b25');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  drawRays(ctx, w * 0.5, h * 0.62, w, 20, t * 0.08, 0.06);
  // sweeping ribbons
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    const y0 = h * (0.25 + 0.25 * k) + Math.sin(t * 0.7 + k) * h * 0.08;
    ctx.moveTo(-50, y0);
    ctx.bezierCurveTo(w * 0.3, y0 - h * 0.35 * Math.sin(t * 0.5 + k), w * 0.7, y0 + h * 0.35 * Math.cos(t * 0.4 + k), w + 50, y0);
    ctx.lineWidth = h * (0.1 - 0.025 * k);
    ctx.strokeStyle = ['rgba(90,80,255,0.35)', 'rgba(255,60,80,0.3)', 'rgba(255,255,255,0.12)'][k];
    ctx.stroke();
  }
  if (scene === 1) {
    // pulsing spotlight rings
    for (let i = 0; i < 6; i++) {
      const rr = ((t * 60 + i * 70) % 420) * (h / 430);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 * (1 - rr / (h * 0.98))})`;
      ctx.lineWidth = h * 0.02;
      ctx.beginPath(); ctx.arc(w * 0.5, h * 0.5, rr, 0, Math.PI * 2); ctx.stroke();
    }
  }
  drawStars(ctx, w, h, t);
  if (scene === 2) {
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.font = `900 ${h * 0.2}px ${LOGO_FONT}`;
    const on = Math.sin(t * 5) > -0.3;
    ctx.globalAlpha = on ? 1 : 0.35;
    ctx.fillText('APPLAUSE!', w * 0.5, h * 0.42);
    ctx.globalAlpha = 1;
    drawLogo(ctx, w * 0.45, h * 0.78, h * 0.2, t);
  } else {
    drawLogo(ctx, w * 0.56, h * 0.6, h * 0.34, t);
  }
  // LIVE badge
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(w * 0.035, h * 0.06, w * 0.11, h * 0.1);
  ctx.fillStyle = Math.sin(t * 4) > 0 ? '#ff2a2a' : '#661010';
  ctx.beginPath(); ctx.arc(w * 0.055, h * 0.11, h * 0.025, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'left';
  ctx.font = `900 ${h * 0.06}px ${LOGO_FONT}`;
  ctx.fillText('LIVE', w * 0.075, h * 0.132);
  // top ticker
  ctx.fillStyle = 'rgba(10,4,30,0.55)';
  ctx.fillRect(w * 0.2, h * 0.055, w * 0.76, h * 0.11);
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${h * 0.06}px ${LOGO_FONT}`;
  ctx.save();
  ctx.beginPath(); ctx.rect(w * 0.2, h * 0.055, w * 0.76, h * 0.11); ctx.clip();
  const tw = ctx.measureText(TICKER).width;
  const x0 = w * 0.2 - ((t * 80) % tw);
  ctx.textAlign = 'left';
  for (let x = x0; x < w; x += tw) ctx.fillText(TICKER, x, h * 0.13);
  ctx.restore();
}
function drawSideA(ctx, w, h, t) {
  const flash = (t % 9) > 6.5;
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, flash ? '#ff2030' : '#3b1290');
  g.addColorStop(1, flash ? '#8a0010' : '#c3163a');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  drawRays(ctx, w * 0.5, h * 0.55, w, 14, -t * 0.12, 0.07);
  drawStars(ctx, w, h, t + 3);
  if (flash) {
    ctx.fillStyle = Math.sin(t * 10) > -0.2 ? '#ffffff' : '#ffd0d0';
    ctx.textAlign = 'center';
    ctx.font = `900 ${h * 0.24}px ${LOGO_FONT}`;
    ctx.fillText('APPLAUSE', w * 0.5, h * 0.6);
  } else {
    drawLogo(ctx, w * 0.45, h * 0.62, h * 0.3, t);
  }
}
function drawSideB(ctx, w, h, t) {
  ctx.fillStyle = '#12082a';
  ctx.fillRect(0, 0, w, h);
  const n = 24, bw = w / n;
  for (let i = 0; i < n; i++) {
    const v = 0.15 + 0.85 * Math.abs(Math.sin(t * (1.3 + (i % 5) * 0.37) + i * 0.8) * Math.sin(t * 0.6 + i * 0.3));
    const bh = v * h * 0.8;
    const g = ctx.createLinearGradient(0, h, 0, h - bh);
    g.addColorStop(0, '#2c3cff'); g.addColorStop(0.6, '#c01ee0'); g.addColorStop(1, '#ff3040');
    ctx.fillStyle = g;
    ctx.fillRect(i * bw + bw * 0.12, h - bh, bw * 0.76, bh);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.textAlign = 'center';
  ctx.font = `italic 900 ${h * 0.2}px ${LOGO_FONT}`;
  ctx.fillText('TUURD Talk', w * 0.5, h * 0.3);
}

function makeScreens() {
  const mk = (w, h, draw) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, color: 0xdddddd });
    return { ctx, w, h, draw, tex, mat };
  };
  const big = mk(1024, 430, drawBigScreen);
  const sideA = mk(512, 264, drawSideA);
  const sideB = mk(512, 264, drawSideB);
  const all = [big, sideA, sideB];
  let last = -1;
  const glowColor = new THREE.Color();
  const state = {
    big, sideA, sideB, glow: null,
    update(t) {
      if (t - last < 1 / 24 && last >= 0) return;
      last = t;
      for (const s of all) { s.draw(s.ctx, s.w, s.h, t); s.tex.needsUpdate = true; }
      if (state.glow) {
        // the screen's dominant hue drifts between violet and crimson; tint its spill light to match
        const k = 0.5 + 0.5 * Math.sin(t * 0.2);
        glowColor.setRGB(0.55 + 0.45 * k, 0.12, 0.75 - 0.45 * k);
        state.glow.color.copy(glowColor);
      }
    },
  };
  state.update(0);
  return state;
}

// ------------------------------------------------------------------ reusable geometries
/** One bay of a square box truss, length 1 along +X, cross-section 1x1 (scale per instance). */
function trussBayGeometry() {
  const parts = [];
  const c = 0.44, t = 0.07; // chord offset, member thickness
  for (const y of [-c, c]) for (const z of [-c, c]) parts.push(new THREE.BoxGeometry(1, t, t).translate(0, y, z));
  const dl = Math.hypot(1, 2 * c), da = Math.atan2(2 * c, 1);
  for (const s of [-c, c]) {
    parts.push(new THREE.BoxGeometry(dl, t * 0.6, t * 0.6).rotateZ(s > 0 ? da : -da).translate(0, 0, s)); // vertical faces
    parts.push(new THREE.BoxGeometry(dl, t * 0.6, t * 0.6).rotateY(s > 0 ? da : -da).translate(0, s, 0)); // horizontal faces
  }
  parts.push(new THREE.BoxGeometry(t * 0.6, 2 * c, t * 0.6).translate(-0.5, 0, c));
  parts.push(new THREE.BoxGeometry(t * 0.6, 2 * c, t * 0.6).translate(-0.5, 0, -c));
  parts.push(new THREE.BoxGeometry(t * 0.6, t * 0.6, 2 * c).translate(-0.5, c, 0));
  parts.push(new THREE.BoxGeometry(t * 0.6, t * 0.6, 2 * c).translate(-0.5, -c, 0));
  return mergeGeometries(parts.map((g) => g.toNonIndexed()));
}

/** Cinema seat facing +Z, origin on the floor at the sitter's position. Returns [blue, black]. */
function seatGeometries() {
  const blue = [], black = [];
  const add = (arr, g, m) => arr.push((g.index ? g.toNonIndexed() : g).applyMatrix4(m));
  add(blue, new RoundedBoxGeometry(0.64, 0.16, 0.6, 1, 0.05), M(0, 0.56, -0.05));                 // cushion
  add(blue, new RoundedBoxGeometry(0.66, 0.8, 0.17, 2, 0.07), M(0, 1.0, -0.5, 0, -0.14));          // backrest
  add(blue, new RoundedBoxGeometry(0.5, 0.2, 0.12, 1, 0.04), M(0, 1.36, -0.56, 0, -0.14));         // head roll
  add(black, new THREE.BoxGeometry(0.62, 0.74, 0.05), M(0, 1.0, -0.6, 0, -0.14));                  // back shell
  for (const s of [-1, 1]) {
    add(black, new THREE.BoxGeometry(0.07, 0.74, 0.7), M(s * 0.37, 0.4, -0.24));                    // side panel
    add(black, new THREE.BoxGeometry(0.11, 0.06, 0.64), M(s * 0.37, 0.8, -0.2));                   // armrest
  }
  add(black, new THREE.BoxGeometry(0.46, 0.34, 0.08), M(0, 0.3, -0.3));                             // pedestal
  return [mergeGeometries(blue), mergeGeometries(black)];
}

/** Stylised toilet, facing +Z, origin on the floor under its centre; seat at (0, 0.62, 0.26). */
function toiletGeometry() {
  const parts = [];
  const add = (g, m) => parts.push((g.index ? g.toNonIndexed() : g).applyMatrix4(m));
  const profile = [[0, 0], [0.15, 0], [0.16, 0.03], [0.135, 0.12], [0.135, 0.27], [0.18, 0.38], [0.245, 0.46],
    [0.285, 0.54], [0.29, 0.585], [0.275, 0.6], [0.225, 0.6], [0.2, 0.55], [0.09, 0.42], [0, 0.4]].map(([r, y]) => new THREE.Vector2(r, y));
  add(new THREE.LatheGeometry(profile, 28), M(0, 0, 0.14, 0, 0, 0, 1, 1, 1.3));                      // pedestal + bowl
  add(new THREE.TorusGeometry(0.225, 0.035, 6, 28), M(0, 0.615, 0.15, 0, Math.PI / 2, 0, 1, 1.3, 0.7)); // seat ring
  add(new RoundedBoxGeometry(0.54, 0.46, 0.24, 2, 0.05), M(0, 0.8, -0.37));                          // tank
  add(new RoundedBoxGeometry(0.58, 0.05, 0.27, 1, 0.02), M(0, 1.04, -0.37));                         // tank lid
  add(new THREE.BoxGeometry(0.28, 0.3, 0.22), M(0, 0.45, -0.22));                                     // neck
  add(new RoundedBoxGeometry(0.5, 0.6, 0.035, 1, 0.015), M(0, 0.93, -0.21, 0, -0.12));               // raised lid
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 10).rotateX(Math.PI / 2), M(0.18, 0.95, -0.24));  // flush button
  return mergeGeometries(parts);
}

/** Hanging stage-light can, aiming along +Z. Lens disc returned separately. */
function canGeometries() {
  const body = mergeGeometries([
    new THREE.CylinderGeometry(0.42, 0.48, 1.1, 20, 1, true).rotateX(Math.PI / 2).toNonIndexed(),
    new THREE.CylinderGeometry(0.44, 0.44, 0.08, 20).rotateX(Math.PI / 2).translate(0, 0, -0.55).toNonIndexed(),
    new THREE.CylinderGeometry(0.52, 0.52, 0.06, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.52).toNonIndexed(),
    new THREE.BoxGeometry(1.2, 0.08, 0.1).translate(0, 0.62, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.08, 0.62, 0.1).translate(-0.58, 0.31, 0).toNonIndexed(),
    new THREE.BoxGeometry(0.08, 0.62, 0.1).translate(0.58, 0.31, 0).toNonIndexed(),
  ]);
  const lens = new THREE.CircleGeometry(0.4, 20).translate(0, 0, 0.5);
  return { body, lens };
}

// ------------------------------------------------------------------ main entry
export async function loadOriginalStage(scene, { lite = false } = {}) {
  const root = new THREE.Group();
  root.name = 'OriginalTalkStage';

  // ---------------- materials
  const floorTex = floorTexture(); floorTex.repeat.set(1, 1);
  const carpetTex = carpetTexture();
  const curtainTex = curtainTexture();
  const tierTex = tierTexture();
  const mats = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.92, metalness: 0 }),
    carpetTop: new THREE.MeshStandardMaterial({ map: carpetTex, bumpMap: carpetTex, bumpScale: 1.5, roughness: 0.95, color: 0xc4c4c4 }),
    carpetSide: new THREE.MeshStandardMaterial({ map: carpetTex, bumpMap: carpetTex, bumpScale: 1.5, roughness: 0.95, color: 0xb8b8b8 }),
    curtain: new THREE.MeshStandardMaterial({ map: curtainTex, roughness: 0.8, side: THREE.DoubleSide }),
    red: new THREE.MeshStandardMaterial({ color: 0xc8140c, roughness: 0.32, metalness: 0.05, emissive: 0x2a0200 }),
    letters: new THREE.MeshStandardMaterial({ color: 0xe0200e, roughness: 0.3, metalness: 0.0, emissive: 0x3a0500 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.55, metalness: 0.6 }),
    truss: new THREE.MeshStandardMaterial({ color: 0x2a2c31, roughness: 0.45, metalness: 0.75 }),
    seatBlue: new THREE.MeshStandardMaterial({ color: 0x1d4fd6, roughness: 0.75 }),
    seatBlack: new THREE.MeshStandardMaterial({ color: 0x141418, roughness: 0.6, metalness: 0.3 }),
    tier: new THREE.MeshStandardMaterial({ map: tierTex, roughness: 0.9 }),
    led: new THREE.MeshBasicMaterial({ color: 0x3a6cff }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff1d0 }),
    porcelain: new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.18, metalness: 0 }),
    props: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 }),
    ceiling: new THREE.MeshBasicMaterial({ color: 0x050506 }),
  };
  const bins = {
    dark: new Bin(mats.dark), red: new Bin(mats.red), curtain: new Bin(mats.curtain),
    tier: new Bin(mats.tier), led: new Bin(mats.led), lamp: new Bin(mats.lamp),
    props: new Bin(mats.props, true), letters: new Bin(mats.letters),
    carpetTop: new Bin(mats.carpetTop), carpetSide: new Bin(mats.carpetSide),
  };

  // ---------------- floor
  const floorGeo = planarUV(new THREE.PlaneGeometry(118, 112).rotateX(-Math.PI / 2).translate(0.5, FLOOR_Y, 0.7), 6);
  const floor = new THREE.Mesh(floorGeo, mats.floor);
  floor.name = 'StudioFloor';
  floor.receiveShadow = true;
  root.add(floor);
  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(118, 112).rotateX(Math.PI / 2).translate(0.5, 22.1, 0.7), mats.ceiling);
  ceiling.name = 'Ceiling';
  root.add(ceiling);

  // ---------------- speaking platform: four stacked carpeted drums
  {
    const { cx, cz, radii, tops } = PLATFORM;
    radii.forEach((R, i) => {
      const side = new THREE.CylinderGeometry(R, R, tops[i] + 0.05, 128, 1, true).translate(cx, (tops[i] - 0.05) / 2, cz);
      const p = side.attributes.position, uv = side.attributes.uv;
      for (let k = 0; k < p.count; k++) uv.setXY(k, uv.getX(k) * 2 * Math.PI * R / 3, p.getY(k) / 3);
      bins.carpetSide.add(side);
      const top = i < radii.length - 1 ? new THREE.RingGeometry(radii[i + 1] - 0.02, R, 128, 1) : new THREE.CircleGeometry(R, 128);
      top.rotateX(-Math.PI / 2).translate(cx, tops[i], cz);
      bins.carpetTop.add(planarUV(top, 3));
    });
  }
  const platformTop = bins.carpetTop.build('PlatformTop');
  const platformSide = bins.carpetSide.build('PlatformSide');
  root.add(platformTop, platformSide);

  // ---------------- big backdrop screen, frame, curtains
  const screens = makeScreens();
  const SCREEN = { x: -0.68, y: 10.59, z: -21.85, w: 43.4, h: 18.2 };
  const bigScreen = new THREE.Mesh(new THREE.PlaneGeometry(SCREEN.w, SCREEN.h), screens.big.mat);
  bigScreen.position.set(SCREEN.x, SCREEN.y, SCREEN.z + 0.02);
  bigScreen.name = 'BackdropScreen';
  root.add(bigScreen);
  {
    const { x, y, z, w, h } = SCREEN, b = 0.45;
    bins.dark.add(new THREE.BoxGeometry(w + 2 * b, b, 0.5), M(x, y + h / 2 + b / 2, z - 0.2));
    bins.dark.add(new THREE.BoxGeometry(w + 2 * b, b, 0.5), M(x, y - h / 2 - b / 2, z - 0.2));
    bins.dark.add(new THREE.BoxGeometry(b, h, 0.5), M(x - w / 2 - b / 2, y, z - 0.2));
    bins.dark.add(new THREE.BoxGeometry(b, h, 0.5), M(x + w / 2 + b / 2, y, z - 0.2));
    bins.dark.add(new THREE.BoxGeometry(w + 3, 1.1, 0.9), M(x, 0.75, z + 0.35));                      // plinth below screen
    // footlights along the screen base
    for (let i = 0; i < 26; i++) {
      const fx = x - w / 2 + 1 + i * (w - 2) / 25;
      bins.dark.add(new THREE.BoxGeometry(0.7, 0.4, 0.5), M(fx, FLOOR_Y + 0.2, z + 1.2, 0, -0.35));
      bins.lamp.add(new THREE.PlaneGeometry(0.5, 0.26), M(fx, FLOOR_Y + 0.26, z + 1.47, 0, -0.35));
    }
  }
  // curtain panel with real folds (geometry) matching the texture folds
  function addCurtain(width, height, matrix, { swag = 0, amp = 0.28 } = {}) {
    const g = new THREE.PlaneGeometry(width, height, Math.ceil(width * 5), swag ? 6 : 1);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + width / 2, y = p.getY(i);
      let yy = y;
      if (swag) {
        // gathered swags: the hem rises toward each gather point
        const s = Math.abs(Math.sin((x / swag) * Math.PI));
        yy = y + (1 - (y + height / 2) / height) * (1 - s) * height * 0.4;
      }
      p.setXYZ(i, p.getX(i), yy, amp * Math.sin((x / FOLD_W) * Math.PI * 2));
      uv.setXY(i, x / (FOLD_W * FOLDS_PER_TILE), (yy + height / 2) / height);
    }
    g.computeVertexNormals();
    bins.curtain.add(g, matrix);
  }
  addCurtain(50, 21.6, M(-1, FLOOR_Y + 10.8, -23.2));                                       // back curtain
  addCurtain(3.2, 20.5, M(-22.75, FLOOR_Y + 10.25, -22.2));                                  // back corners
  addCurtain(3.2, 20.5, M(21.2, FLOOR_Y + 10.25, -22.2));
  addCurtain(47, 2.6, M(-0.7, 21.0, -21.3), { swag: 4.7, amp: 0.22 });                       // top valance
  addCurtain(44.5, 0.9, M(-0.7, 1.55, -21.25), { amp: 0.12 });                                // pelmet under screen
  addCurtain(22, 21, M(-25.3, FLOOR_Y + 10.5, -12.2, Math.PI / 2 - 5.3 * DEG));              // left side curtain
  addCurtain(22, 21, M(24.0, FLOOR_Y + 10.5, -12.6, -Math.PI / 2));                           // right side curtain

  // ---------------- side walls: two stacked image screens each, red frames and pillars
  {
    const sides = [
      { x: 22.52, ry: -Math.PI / 2 },                         // right, faces -X
      { x: -23.72, ry: Math.PI / 2 - 5.3 * DEG },             // left, faces +X, splayed toward the audience
    ];
    const zc = -12.43, pw = 15.9, ph = 8.2, panelsA = [], panelsB = [];
    for (const s of sides) {
      const base = new THREE.Matrix4().makeTranslation(s.x, 0, zc).multiply(new THREE.Matrix4().makeRotationY(s.ry));
      const at = (lx, y, lz, extra = new THREE.Matrix4()) => base.clone().multiply(new THREE.Matrix4().makeTranslation(lx, y, lz)).multiply(extra);
      // panels in the wall's local frame: local +Z = facing direction, local X along the wall
      panelsA.push(new THREE.PlaneGeometry(pw, ph).applyMatrix4(at(0, 15.0, 0.05)));
      panelsB.push(new THREE.PlaneGeometry(pw, ph).applyMatrix4(at(0, 5.6, 0.05)));
      // frame: bottom skirt, middle band, top band, front + back pillars
      bins.red.add(new THREE.BoxGeometry(pw + 0.4, 1.3, 0.5), at(0, FLOOR_Y + 0.65, -0.2));
      bins.red.add(new THREE.BoxGeometry(pw + 0.4, 1.2, 0.5), at(0, 10.3, -0.2));
      bins.red.add(new THREE.BoxGeometry(pw + 0.4, 1.3, 0.5), at(0, 19.75, -0.2));
      const front = s.x > 0 ? 1 : -1; // which local X end points toward the audience (+Z world)
      bins.red.add(new THREE.BoxGeometry(1.3, 21.2, 1.3), at(front * (pw / 2 + 0.65), FLOOR_Y + 10.6, 0.1));
      bins.red.add(new THREE.BoxGeometry(0.8, 21.2, 0.8), at(-front * (pw / 2 + 0.4), FLOOR_Y + 10.6, -0.1));
      bins.dark.add(new THREE.BoxGeometry(pw, 18.4, 0.2), at(0, 10.3, -0.35));
    }
    const sa = new THREE.Mesh(mergeGeometries(panelsA), screens.sideA.mat);
    const sb = new THREE.Mesh(mergeGeometries(panelsB), screens.sideB.mat);
    sa.name = 'SideScreensUpper'; sb.name = 'SideScreensLower';
    root.add(sa, sb);
  }

  // ---------------- TUURD block letters (TextGeometry, Droid Sans Bold)
  let font = null;
  try { font = await new FontLoader().loadAsync(FONT_URL); } catch (e) { console.warn('[stage-original] font failed, using block letters', e); }
  function lettersGeometry(heightM, widthM, depthM) {
    let g;
    if (font) {
      g = new TextGeometry('TUURD', { font, size: 1, depth: 0.25, curveSegments: 6, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.012, bevelSegments: 2 });
    } else {
      g = blockLetters();
    }
    g.computeBoundingBox();
    const bb = g.boundingBox, sz = bb.getSize(new THREE.Vector3());
    g.translate(-(bb.min.x + sz.x / 2), -bb.min.y, -(bb.min.z + sz.z / 2));
    g.scale(widthM / sz.x, heightM / sz.y, depthM / sz.z);
    return g;
  }
  bins.letters.add(lettersGeometry(3.28, 13.2, 0.75), M(-7.31, FLOOR_Y, -15.99, 19.7 * DEG));      // beside the platform
  bins.letters.add(lettersGeometry(3.28, 13.2, 0.75), M(0.23, TIER_TOP - 0.1, 34.1, Math.PI));     // atop the back tier

  // ---------------- seating: 18 rows x 20 cinema seats (instanced)
  const audience = [];
  const hostV = new THREE.Vector3(...HOST);
  ROWS.forEach(([x0, y, z0, yawDeg], r) => {
    const yaw = yawDeg * DEG;
    const rd = [Math.cos(yaw), 0, -Math.sin(yaw)];
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    SEAT_OFFSETS.forEach((o, s) => {
      const pos = new THREE.Vector3(x0 + rd[0] * o, y, z0 + rd[2] * o);
      const th = hostV.clone().sub(pos).setY(0).normalize();
      audience.push({
        name: `AUDIENCE_r${String(r).padStart(2, '0')}_s${String(s).padStart(2, '0')}`,
        row: r, seat: s,
        position: pos.toArray().map(round4),
        quaternion: q.toArray().map(round6),
        forward: fwd.toArray().map(round4),
        toHost: th.toArray().map(round4),
      });
    });
  });
  {
    const [gBlue, gBlack] = seatGeometries();
    const blue = new THREE.InstancedMesh(gBlue, mats.seatBlue, audience.length);
    const black = new THREE.InstancedMesh(gBlack, mats.seatBlack, audience.length);
    const m4 = new THREE.Matrix4(), one = new THREE.Vector3(1, 1, 1);
    audience.forEach((a, i) => {
      m4.compose(new THREE.Vector3(...a.position), new THREE.Quaternion(...a.quaternion), one);
      blue.setMatrixAt(i, m4); black.setMatrixAt(i, m4);
    });
    blue.name = 'SeatsFabric'; black.name = 'SeatsFrame';
    blue.computeBoundingSphere(); black.computeBoundingSphere();
    root.add(blue, black);
  }

  // ---------------- raised seating tiers (back + both sides)
  const TIER_W = 22.9, TIER_DEPTH_BEHIND = 9.5;
  for (const [ra, rb] of TIER_SECTIONS) {
    const [x0, ya, z0, yawDeg] = ROWS[ra];
    const yb = ROWS[rb][1];
    const yaw = yawDeg * DEG;
    const f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const rd = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const c = new THREE.Vector3(x0, 0, z0).addScaledVector(rd, ROW_MID);                  // centre of row A
    const pB = new THREE.Vector3(ROWS[rb][0], 0, ROWS[rb][2]).addScaledVector(rd, ROW_MID);
    const dAB = pB.clone().sub(c).dot(f) * -1;                                              // depth of row B behind row A
    const levels = [[-1.7, ya], [dAB - 1.75, yb], [dAB + 1.6, TIER_TOP]];                    // [front depth, surface y]
    const base = new THREE.Matrix4().makeTranslation(c.x, 0, c.z).multiply(new THREE.Matrix4().makeRotationY(yaw));
    for (const [d0, top] of levels) {
      const depth = TIER_DEPTH_BEHIND - d0, hgt = top + 0.4;
      const g = new THREE.BoxGeometry(TIER_W, hgt, depth);
      // UV in metres so the riser texture tiles evenly
      const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i));
        uv.setXY(i, (ax > 0.5 ? p.getZ(i) : p.getX(i)) / 3, (ay > 0.5 ? p.getZ(i) : p.getY(i)) / 3);
      }
      bins.tier.add(g, base.clone().multiply(new THREE.Matrix4().makeTranslation(0, hgt / 2 - 0.4, -(d0 + depth / 2))));
      // glowing edge strip along the step nosing
      bins.led.add(new THREE.BoxGeometry(TIER_W, 0.06, 0.06), base.clone().multiply(new THREE.Matrix4().makeTranslation(0, top - 0.02, -d0 + 0.02)));
    }
  }

  // ---------------- toilets (sittable seats, one on stage next to the host)
  const toiletSeats = [];
  {
    const surfaces = [FLOOR_Y, PLATFORM_TOP, 2.2, 4.12, TIER_TOP];
    const inst = new THREE.InstancedMesh(toiletGeometry(), mats.porcelain, TOILETS.length);
    TOILETS.forEach(([sx, sy, sz, fx, fz], i) => {
      const yaw = Math.atan2(fx, fz);
      const surf = surfaces.filter((s) => s <= sy - 0.3).reduce((a, b) => Math.max(a, b), FLOOR_Y);
      const scale = (sy - surf) / TOILET_SEAT_H;
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const fwd = new THREE.Vector3(fx, 0, fz).normalize();
      const basePos = new THREE.Vector3(sx, surf, sz).addScaledVector(fwd, -TOILET_SEAT_FWD * scale);
      inst.setMatrixAt(i, new THREE.Matrix4().compose(basePos, q, new THREE.Vector3(scale, scale, scale)));
      const seatPos = new THREE.Vector3(sx, sy, sz);
      toiletSeats.push({
        name: `TOILETSEAT_${String(i).padStart(2, '0')}`,
        position: seatPos.toArray().map(round4),
        quaternion: q.toArray().map(round6),
        forward: fwd.toArray().map(round4),
        toHost: hostV.clone().sub(seatPos).setY(0).normalize().toArray().map(round4),
      });
    });
    inst.name = 'Toilets';
    inst.computeBoundingSphere();
    root.add(inst);
  }

  // ---------------- truss rig: corner towers, perimeter grid, cross truss, light towers
  const trussMatrices = [];
  const X = new THREE.Vector3(1, 0, 0);
  function truss(a, b, h, w, bay = h) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const dir = B.clone().sub(A), len = dir.length();
    dir.normalize();
    const n = Math.max(1, Math.round(len / bay)), bl = len / n;
    const q = new THREE.Quaternion().setFromUnitVectors(X, dir);
    for (let i = 0; i < n; i++) {
      const p = A.clone().addScaledVector(dir, (i + 0.5) * bl);
      trussMatrices.push(new THREE.Matrix4().compose(p, q, new THREE.Vector3(bl, h, w)));
    }
  }
  const TX0 = -26.6, TX1 = 25.5, TZ0 = -25.5, TZ1 = 26.9, TY = 16.4;
  for (const [x, z] of [[TX0, TZ0], [TX1, TZ0], [TX0, TZ1], [TX1, TZ1]]) truss([x, FLOOR_Y, z], [x, 22.1, z], 2.9, 2.9);
  truss([TX0 + 1.45, TY, TZ0], [TX1 - 1.45, TY, TZ0], 2.15, 1.3);
  truss([TX0 + 1.45, TY, TZ1], [TX1 - 1.45, TY, TZ1], 2.15, 1.3);
  truss([TX0, TY, TZ0 + 1.45], [TX0, TY, TZ1 - 1.45], 2.15, 1.3);
  truss([TX1, TY, TZ0 + 1.45], [TX1, TY, TZ1 - 1.45], 2.15, 1.3);
  truss([TX0 + 0.65, TY + 0.4, 6.7], [TX1 - 0.65, TY + 0.4, 6.7], 1.3, 1.3);
  // free-standing lamp towers around the audience
  const LAMP_TOWERS = [[-18.0, 28.5], [17.9, 30.8], [33.9, -0.45], [-34.4, -1.6]];
  for (const [x, z] of LAMP_TOWERS) truss([x, FLOOR_Y, z], [x, 9.4, z], 0.6, 0.6, 0.9);
  {
    const inst = new THREE.InstancedMesh(trussBayGeometry(), mats.truss, trussMatrices.length);
    trussMatrices.forEach((m, i) => inst.setMatrixAt(i, m));
    inst.name = 'Truss';
    inst.computeBoundingSphere();
    root.add(inst);
  }

  // ---------------- hanging light cans (instanced) + actual lights
  const stageAim = new THREE.Vector3(0, PLATFORM_TOP + 0.5, -6.5);
  const cans = [
    [-0.52, 14.6, 6.7], [0.16, 14.6, 26.9], [-17.97, 14.6, 26.9], [-16.48, 14.6, 6.6],
    [17.21, 14.6, 6.8], [19.4, 14.6, 27.2], [25.5, 14.6, -0.24], [-26.6, 14.6, 0.24],
  ];
  const canPlaces = cans.map((p) => ({ p: new THREE.Vector3(...p), aim: stageAim }));
  for (const [x, z] of LAMP_TOWERS) {
    canPlaces.push({ p: new THREE.Vector3(x - 0.5, 9.9, z), aim: stageAim });
    canPlaces.push({ p: new THREE.Vector3(x + 0.5, 9.9, z), aim: new THREE.Vector3(0, 6, -21) });
  }
  {
    const { body, lens } = canGeometries();
    const ib = new THREE.InstancedMesh(body, mats.dark, canPlaces.length);
    const il = new THREE.InstancedMesh(lens, mats.lamp, canPlaces.length);
    canPlaces.forEach(({ p, aim }, i) => {
      _o.position.copy(p); _o.scale.set(1, 1, 1); _o.rotation.set(0, 0, 0); _o.lookAt(aim); _o.updateMatrix();
      ib.setMatrixAt(i, _o.matrix); il.setMatrixAt(i, _o.matrix);
      if (i < cans.length) bins.dark.add(new THREE.CylinderGeometry(0.05, 0.05, TY - 1.07 - p.y, 6), M(p.x, (TY - 1.07 + p.y) / 2 + 0.3, p.z));
    });
    ib.name = 'LightCans'; il.name = 'LightLenses';
    ib.computeBoundingSphere(); il.computeBoundingSphere();
    root.add(ib, il);
  }

  // ---------------- a few original stylised props where the set has open floor
  {
    const P = bins.props;
    // giant vintage microphone, stage right
    const mic = new THREE.Matrix4().makeTranslation(11.2, FLOOR_Y, -14.5).multiply(new THREE.Matrix4().makeRotationY(-0.5));
    const at = (m) => mic.clone().multiply(m);
    P.add(new THREE.CylinderGeometry(1.1, 1.35, 0.3, 32), at(M(0, 0.15, 0)), 0x2b2b30);
    P.add(new THREE.CylinderGeometry(0.1, 0.12, 4.6, 12), at(M(0, 2.55, 0)), 0xb8bcc4);
    P.add(new THREE.TorusGeometry(0.55, 0.07, 8, 24, Math.PI), at(M(0, 5.0, 0, 0, 0, Math.PI)), 0xb8bcc4);
    P.add(new THREE.CapsuleGeometry(0.46, 0.9, 8, 20), at(M(0, 5.35, 0, 0, 0.35)), 0x9aa0aa);
    for (const k of [-0.25, 0.1, 0.45]) P.add(new THREE.TorusGeometry(0.47, 0.035, 6, 24), at(M(0, 5.35 + k, k * 0.36, 0, Math.PI / 2 + 0.35)), 0xe8e8ea);
    P.add(new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12), at(M(0, 4.55, -0.25, 0, 0.35)), 0x202024);
    // stack of gift boxes, stage right back
    const box = (x, y, z, s, ry, col, rib) => {
      P.add(new THREE.BoxGeometry(s, s, s), M(x, y + s / 2, z, ry), col);
      P.add(new THREE.BoxGeometry(s * 1.01, s * 1.01, s * 0.14), M(x, y + s / 2, z, ry), rib);
      P.add(new THREE.BoxGeometry(s * 0.14, s * 1.01, s * 1.01), M(x, y + s / 2, z, ry), rib);
      P.add(new THREE.TorusGeometry(s * 0.16, s * 0.05, 6, 16), M(x, y + s + s * 0.1, z, ry + 0.8), rib);
      P.add(new THREE.TorusGeometry(s * 0.16, s * 0.05, 6, 16), M(x, y + s + s * 0.1, z, ry - 0.8), rib);
    };
    box(15.8, FLOOR_Y, -17.2, 2.3, 0.3, 0xc81d2a, 0xf2c14e);
    box(15.9, FLOOR_Y + 2.3, -17.1, 1.5, 0.9, 0x2f4fd8, 0xf5f5f5);
    box(18.4, FLOOR_Y, -15.6, 1.4, -0.4, 0xf2c14e, 0xc81d2a);
    // studio TV camera on a tripod, stage left, pointed at the host
    const cam = new THREE.Matrix4().makeTranslation(-16.5, FLOOR_Y, -8.5).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(0 + 16.5, -6 + 8.5)));
    const cat = (m) => cam.clone().multiply(m);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      P.add(new THREE.CylinderGeometry(0.05, 0.07, 3.1, 6), cat(M(Math.sin(a) * 0.55, 1.45, Math.cos(a) * 0.55, 0, -Math.cos(a) * 0.36, Math.sin(a) * 0.36)), 0x1c1c20);
    }
    P.add(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 8), cat(M(0, 3.05, 0)), 0x1c1c20);
    P.add(new RoundedBoxGeometry(1.0, 1.0, 1.9, 2, 0.1), cat(M(0, 3.75, 0)), 0x3a3d44);
    P.add(new THREE.CylinderGeometry(0.34, 0.4, 0.9, 16).rotateX(Math.PI / 2), cat(M(0, 3.7, 1.35)), 0x121214);
    P.add(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 16).rotateX(Math.PI / 2), cat(M(0, 3.7, 1.81)), 0x4060a0);
    P.add(new THREE.BoxGeometry(0.6, 0.45, 0.4), cat(M(0.55, 4.35, -0.5)), 0x2a2a2e);
    P.add(new THREE.BoxGeometry(0.16, 0.1, 0.05), cat(M(0, 4.3, 0.97)), 0xff2020);
    P.add(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6).rotateX(Math.PI / 2 - 0.3), cat(M(0.3, 3.4, -1.4)), 0x1c1c20);
  }

  // ---------------- build merged static meshes
  for (const [k, b] of Object.entries(bins)) {
    if (k === 'carpetTop' || k === 'carpetSide') continue;
    const m = b.build('Static_' + k);
    if (m) root.add(m);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });

  // ---------------- lights
  const lights = [];
  const lightGroup = new THREE.Group();
  lightGroup.name = 'StageLights';
  root.add(lightGroup);
  function spot(name, color, intensity, pos, target, angle, penumbra, distance = 45, decay = 1.5) {
    const l = new THREE.SpotLight(color, intensity, distance, angle, penumbra, decay);
    l.name = name;
    l.position.set(...pos);
    l.target.position.set(...target);
    lightGroup.add(l, l.target);
    record(l, 'spot', target);
    return l;
  }
  function point(name, color, intensity, pos, distance, decay = 1.5) {
    const l = new THREE.PointLight(color, intensity, distance, decay);
    l.name = name;
    l.position.set(...pos);
    lightGroup.add(l);
    record(l, 'point');
    return l;
  }
  function record(l, type, target) {
    const fwd = target ? new THREE.Vector3(...target).sub(l.position).normalize() : new THREE.Vector3(0, 0, 1);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), fwd);
    lights.push({
      name: 'LIGHT_' + l.name, type, color: l.color.toArray().map(round4), intensity: l.intensity, distance: l.distance,
      position: l.position.toArray().map(round4), quaternion: q.toArray().map(round6), forward: fwd.toArray().map(round4),
    });
  }
  const hostAim = [HOST[0], PLATFORM_TOP, HOST[2] - 1];
  spot('Spot_Front', 0xfff0dc, 380, [-0.52, 14.2, 6.7], hostAim, 0.3, 0.6);
  spot('Spot_Left', 0xffd4e8, 260, [-16.48, 14.2, 6.6], [-1, PLATFORM_TOP, -7.5], 0.3, 0.7);
  spot('Spot_Right', 0xd6e2ff, 260, [17.21, 14.2, 6.8], [1, PLATFORM_TOP, -7.5], 0.3, 0.7);
  spot('Wash_Letters', 0xff2a40, 500, [4, 13, 1], [-7.3, 1.6, -16], 0.32, 0.8);
  if (!lite) {
    point('Blue_Audience_L', 0x2a70ff, 90, [-22.59, 8.79, 12.19], 26);
    point('Blue_Audience_R', 0x2a70ff, 90, [23.65, 8.79, 11.08], 26);
    point('Blue_Audience_Back', 0x2a70ff, 90, [0.62, 8.79, 31.35], 26);
    point('Red_Letters', 0xff1030, 40, [-6.24, 3.46, -12.2], 14);
    screens.glow = point('Screen_Glow', 0xc02080, 70, [-0.7, 7, -19.5], 20);
  }

  scene.add(root);
  root.updateMatrixWorld(true);

  // ---------------- markers
  const hostQ = [0, 0, 0, 1];
  const guestFwd = new THREE.Vector3(-0.5, 0, 0.866);
  const guestQ = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), guestFwd);
  const camFwd = new THREE.Vector3(...CAMERA.forward).normalize();
  const camM = new THREE.Matrix4().lookAt(new THREE.Vector3(), camFwd.clone().negate(), new THREE.Vector3(0, 1, 0));
  const camQ = new THREE.Quaternion().setFromRotationMatrix(camM);
  const R = PLATFORM.radii[0];
  const markers = {
    coordinateSystem: 'glTF / three.js: right-handed, +Y up, metres; stage faces +Z toward the audience',
    source: 'js/stage-original.js (procedurally generated)',
    host: { name: 'HOST_CenterStage', position: HOST, quaternion: hostQ, forward: [0, 0, 1] },
    guest: { name: 'GUEST_Spot', position: GUEST, quaternion: guestQ.toArray().map(round6), forward: guestFwd.toArray().map(round4) },
    camera: { name: 'CAMERA_Default', position: CAMERA.position, quaternion: camQ.toArray().map(round6), forward: camFwd.toArray().map(round4) },
    audience,
    toiletSeats,
    randomSpawns: SPAWNS.map(([x, z], i) => ({ name: `SPAWN_Random_${String(i).padStart(2, '0')}`, position: [x, FLOOR_Y, z], quaternion: [0, 0, 0, 1], forward: [0, 0, 1] })),
    lights,
    stageCenter: {
      name: 'STAGE_Center', position: [PLATFORM.cx, PLATFORM_TOP, PLATFORM.cz],
      boundsMin: [PLATFORM.cx - R, 0, PLATFORM.cz - R], boundsMax: [PLATFORM.cx + R, PLATFORM_TOP, PLATFORM.cz + R],
      note: 'top-centre of the speaking platform',
    },
  };

  // ---------------- marker helpers (hidden by default), same as js/stage.js
  const markerGroup = new THREE.Group();
  markerGroup.name = 'MarkerHelpers';
  markerGroup.visible = false;
  {
    const seats = new THREE.InstancedMesh(new THREE.ConeGeometry(0.18, 0.5, 8), new THREE.MeshBasicMaterial({ color: 0x33ccff }), audience.length);
    const m4 = new THREE.Matrix4();
    audience.forEach((a, i) => { m4.makeTranslation(a.position[0], a.position[1] + 0.4, a.position[2]); seats.setMatrixAt(i, m4); });
    markerGroup.add(seats);
    const hostHelper = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0xff3366, side: THREE.DoubleSide }));
    hostHelper.rotation.x = -Math.PI / 2;
    hostHelper.position.set(HOST[0], PLATFORM_TOP + 0.02, HOST[2]);
    markerGroup.add(hostHelper);
  }
  scene.add(markerGroup);

  const ground = [platformTop, platformSide, floor];
  return { root, markers, ground, markerGroup, screens };
}

function round4(v) { return Math.round(v * 1e4) / 1e4; }
function round6(v) { return Math.round(v * 1e6) / 1e6; }

/** Fallback if the font cannot be fetched: chunky T-U-U-R-D from boxes (1 unit tall). */
function blockLetters() {
  const parts = [];
  const b = (x, y, w, h) => parts.push(new THREE.BoxGeometry(w, h, 0.25).translate(x + w / 2, y + h / 2, 0).toNonIndexed());
  const s = 0.2; let x = 0;
  b(x, 1 - s, 0.8, s); b(x + 0.3, 0, s, 1); x += 0.9;                              // T
  for (let k = 0; k < 2; k++) { b(x, 0, s, 1); b(x + 0.55, 0, s, 1); b(x, 0, 0.75, s); x += 0.9; } // U U
  b(x, 0, s, 1); b(x, 1 - s, 0.6, s); b(x, 0.45, 0.6, s); b(x + 0.55, 0.45, s, 0.55); b(x + 0.35, 0, s, 0.45); x += 0.9; // R
  b(x, 0, s, 1); b(x, 1 - s, 0.55, s); b(x, 0, 0.55, s); b(x + 0.55, 0.15, s, 0.7);  // D
  return mergeGeometries(parts);
}
