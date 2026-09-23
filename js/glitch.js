// NES-style corruption over the 3D view, for a few seconds after Leno eats the Vinesauce mushroom: the frame is
// sampled down to NES resolution and snapped to the NES palette, 8x8 tiles are swapped, flipped or replaced by
// garbage, scanlines tear sideways, and the palette shifts now and then. Drawn on a 2D canvas over the WebGL
// canvas (which keeps its drawing buffer), under the HUD and buttons.

// the NES's 2C02 palette (a common RGB rendering), 54 usable colours
const NES = [
  0x7c7c7c, 0x0000fc, 0x0000bc, 0x4428bc, 0x940084, 0xa80020, 0xa81000, 0x881400, 0x503000, 0x007800, 0x006800, 0x005800, 0x004058,
  0xbcbcbc, 0x0078f8, 0x0058f8, 0x6844fc, 0xd800cc, 0xe40058, 0xf83800, 0xe45c10, 0xac7c00, 0x00b800, 0x00a800, 0x00a844, 0x008888,
  0xf8f8f8, 0x3cbcfc, 0x6888fc, 0x9878f8, 0xf878f8, 0xf85898, 0xf87858, 0xfca044, 0xf8b800, 0xb8f818, 0x58d854, 0x58f898, 0x00e8d8,
  0x787878, 0xfcfcfc, 0xa4e4fc, 0xb8b8f8, 0xd8b8f8, 0xf8b8f8, 0xf8a4c0, 0xf0d0b0, 0xfce0a8, 0xf8d878, 0xd8f878, 0xb8f8b8, 0xb8f8d8,
  0x00fcfc, 0x000000,
].map((c) => [(c >> 16) & 255, (c >> 8) & 255, c & 255]);

export class NesGlitch {
  constructor(viewport, source) {
    this.source = source;                               // the WebGL canvas
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '1', imageRendering: 'pixelated', display: 'none' });
    source.after(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.low = document.createElement('canvas');
    this.lctx = this.low.getContext('2d', { willReadFrequently: true });
    this.t = 0; this.dur = 0; this.shift = 0;
    // 32-level lookup cube: RGB -> nearest NES colour (with a palette shift applied at draw time)
    this.lut = new Uint8Array(32 * 32 * 32);
    for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
      let best = 0, bd = Infinity;
      for (let i = 0; i < NES.length; i++) {
        const [R, G, B] = NES[i], d = (R - r * 8.2) ** 2 * 0.3 + (G - g * 8.2) ** 2 * 0.59 + (B - b * 8.2) ** 2 * 0.11;
        if (d < bd) { bd = d; best = i; }
      }
      this.lut[(r << 10) | (g << 5) | b] = best;
    }
  }

  get active() { return this.t < this.dur; }

  start(dur = 5) { this.t = 0; this.dur = dur; this.shift = 0; this.canvas.style.display = 'block'; }

  stop() { this.dur = 0; this.canvas.style.display = 'none'; }

  /** call right after the 3D view has rendered; returns the corruption level 0..1 (for the fly's eyes) */
  update(dt) {
    if (!this.active) { if (this.canvas.style.display !== 'none') this.stop(); return 0; }
    this.t += dt;
    const k = Math.max(0, 1 - this.t / this.dur) ** 0.6;           // strongest at first, fading
    const W = this.source.width, H = this.source.height;
    if (!W || !H) return k;
    // flicker: now and then a clean frame shows through
    if (Math.random() < 0.12 * (1 - k)) { this.canvas.style.visibility = 'hidden'; return k; }
    this.canvas.style.visibility = 'visible';
    const lw = 256, lh = Math.max(8, Math.round(256 * H / W / 8) * 8);
    if (this.low.width !== lw || this.low.height !== lh) { this.low.width = lw; this.low.height = lh; }
    if (this.canvas.width !== lw || this.canvas.height !== lh) { this.canvas.width = lw; this.canvas.height = lh; }
    const L = this.lctx;
    L.imageSmoothingEnabled = false;
    L.drawImage(this.source, 0, 0, lw, lh);
    const img = L.getImageData(0, 0, lw, lh), d = img.data;
    if (Math.random() < 0.08) this.shift = (Math.random() * NES.length) | 0;   // palette shift
    // snap to the NES palette (shifted)
    for (let i = 0; i < d.length; i += 4) {
      const c = NES[(this.lut[((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)] + this.shift) % NES.length];
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    // tile corruption: swap, flip or garbage-fill 8x8 tiles
    const tw = lw / 8, th = lh / 8, n = Math.round(tw * th * 0.18 * k);
    const src = new Uint8ClampedArray(d);
    for (let j = 0; j < n; j++) {
      const tx = (Math.random() * tw) | 0, ty = (Math.random() * th) | 0, mode = Math.random();
      const sx = (Math.random() * tw) | 0, sy = (Math.random() * th) | 0;
      const g1 = NES[(Math.random() * NES.length) | 0], g2 = NES[(Math.random() * NES.length) | 0], pat = (Math.random() * 256) | 0;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const o = (((ty * 8 + y) * lw) + tx * 8 + x) * 4;
        let c;
        if (mode < 0.45) { const so = (((sy * 8 + y) * lw) + sx * 8 + x) * 4; c = [src[so], src[so + 1], src[so + 2]]; }        // wrong tile
        else if (mode < 0.65) { const so = (((ty * 8 + 7 - y) * lw) + tx * 8 + x) * 4; c = [src[so], src[so + 1], src[so + 2]]; } // flipped
        else c = ((pat >> ((x + y * 3) & 7)) & 1) ? g1 : g2;                                                                   // garbage
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2];
      }
    }
    L.putImageData(img, 0, 0);
    // scanline tears: a few bands slide sideways
    const C = this.ctx;
    C.imageSmoothingEnabled = false;
    C.clearRect(0, 0, lw, lh);
    C.drawImage(this.low, 0, 0);
    const bands = Math.round(6 * k);
    for (let b = 0; b < bands; b++) {
      const y = (Math.random() * lh) | 0, h = 1 + ((Math.random() * 6) | 0), off = ((Math.random() - 0.5) * 60 * k) | 0;
      C.drawImage(this.low, 0, y, lw, h, off, y, lw, h);
    }
    return k;
  }
}
