// Sidebar: stimulus controls + live neural data (stats, motor meters, raster, group rates, classes).
const CLASS_COLORS = {
  ascending: '#f5b041', central: '#af7ac5', descending: '#e0263a', endocrine: '#48c9b0', motor: '#ff6f91',
  optic: '#3fb3ff', sensory: '#58d68d', sensory_ascending: '#a3e4d7', unknown: '#777', visual_centrifugal: '#5dade2',
  visual_projection: '#85c1e9',
};
const MOTOR_COLOR = '#e0263a', STIM_COLOR = '#58d68d';
const RASTER_WINDOW = 2.0; // seconds
const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const $ = (id) => document.getElementById(id);

export class Sidebar {
  constructor({ meta, onStim, onPause, onReset, onSpeed, onAutopilot }) {
    this.meta = meta;
    this.onStim = onStim;
    this.manual = new Set();
    this.auto = new Set();
    this.autoCount = {};                // key -> number of controllers holding it on (director, mind)
    this.history = {};                  // group -> recent rates
    this.classes = meta.superClasses;

    $('statNeurons').textContent = fmt(meta.N);
    $('statSynapses').textContent = fmt(meta.E);
    $('btnPause').onclick = () => { this.paused = !this.paused; $('btnPause').textContent = this.paused ? 'Run' : 'Pause'; onPause(this.paused); };
    $('btnReset').onclick = onReset;
    $('simSpeed').oninput = (e) => onSpeed(+e.target.value);

    // stimuli
    const st = $('stimuli');
    st.innerHTML = `<label class="chk" style="margin:0 0 6px"><input type="checkbox" id="autopilot" checked> Autopilot (show director)</label>
      <div id="ticker" class="status" style="margin-bottom:6px">—</div>`;
    $('autopilot').onchange = (e) => onAutopilot(e.target.checked);
    this.stimEls = {};
    const chips = document.createElement('div');
    chips.className = 'chips';
    st.appendChild(chips);
    for (const s of meta.stimuli) {
      if (s.hidden) continue;
      const btn = document.createElement('button');
      btn.className = 'chip' + (s.fictive ? ' fictive' : '');
      btn.title = `${s.sub} — ${s.indices.length} neurons (${s.cellTypes.slice(0, 4).join(', ')}) Poisson ${s.rate} Hz`;
      btn.innerHTML = `<span class="dot"></span>${s.label}`;
      btn.onclick = () => {
        if (this.manual.has(s.key)) this.manual.delete(s.key); else this.manual.add(s.key);
        this.refreshStim(s.key);
      };
      this.stimEls[s.key] = { btn };
      chips.appendChild(btn);
    }

    // motor meters
    const mo = $('motor');
    this.meters = {};
    const meterDefs = [
      ['forward', 'Forward', 'P9 / oDN1'], ['backward', 'Backward', 'MDN'], ['turn', 'Turn L ↔ R', 'DNa01/02 L−R', true],
      ['startle', 'Startle', 'giant fiber'], ['groom', 'Groom', 'aDN1'], ['feed', 'Feed / talk', 'MN9'],
    ];
    for (const [key, label, sub, bi] of meterDefs) {
      const el = document.createElement('div');
      el.className = 'meter' + (bi ? ' bi' : '');
      el.innerHTML = `<div class="lbl">${label}<small>${sub}</small></div><div class="bar"><i></i></div><div class="num">0</div>`;
      mo.appendChild(el);
      this.meters[key] = { bar: el.querySelector('i'), num: el.querySelector('.num'), bi };
    }

    // group rates
    const gr = $('groups');
    this.groupEls = {};
    const rows = [...meta.motor.map((m) => ['m:' + m.key, `${m.label}`, m.cellTypes.join(', '), MOTOR_COLOR]),
      ...meta.stimuli.filter((s) => !s.fictive && !s.hidden).map((s) => ['s:' + s.key, s.label, s.cellTypes.slice(0, 3).join(', '), STIM_COLOR])];
    for (const [key, label, sub, color] of rows) {
      const el = document.createElement('div');
      el.className = 'grp';
      el.innerHTML = `<div class="sw" style="background:${color}"></div><div>${label} <small style="color:var(--muted)">${sub}</small></div><canvas width="120" height="32"></canvas><div class="num">0</div>`;
      gr.appendChild(el);
      this.groupEls[key] = { spark: el.querySelector('canvas'), num: el.querySelector('.num') };
      this.history[key] = [];
    }

    this.raster = $('raster');
    this.classCanvas = $('classes');
    // canvases are only redrawn while they are on screen (phones: most of the sidebar is scrolled away)
    this.onScreen = new WeakMap();
    this.io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => this.onScreen.set(e.target, e.isIntersecting)), { rootMargin: '100px' })
      : null;
    for (const c of [this.raster, this.classCanvas]) this.io?.observe(c);
    this.resizeCanvases();
    addEventListener('resize', () => this.resizeCanvases());
  }

  resizeCanvases() {
    for (const c of [this.raster, this.classCanvas]) {
      const w = c.clientWidth * devicePixelRatio;
      if (c.width !== w) { c.width = w; c.height = (+c.getAttribute('height')) * devicePixelRatio; }
    }
  }

  setReady(info) {
    this.rows = info.rows;
    this.fixedRows = info.fixedRows;
    $('rasterInfo').textContent = `${info.fixedRows.length} tagged + ${info.rows - info.fixedRows.length} most-recently-active neurons`;
  }

  isOn(key) { return this.manual.has(key) || this.auto.has(key); }

  setAuto(key, on) {
    const n = Math.max(0, (this.autoCount[key] || 0) + (on ? 1 : -1));
    this.autoCount[key] = n;
    if (n > 0) this.auto.add(key); else this.auto.delete(key);
    this.refreshStim(key);
  }

  refreshStim(key) {
    const s = this.meta.stimuli.find((x) => x.key === key);
    const on = this.isOn(key);
    const el = this.stimEls[key];
    if (el) {
    el.btn.classList.toggle('on', on);
    el.btn.classList.toggle('auto', !this.manual.has(key) && this.auto.has(key));
    }
    this.onStim(s, on ? s.rate : 0);
  }

  ticker(text) { $('ticker').textContent = text; }

  status(text, cls = '') { const e = $('brainStatus'); e.textContent = text; e.className = 'status ' + cls; }

  update(tick, motor) {
    $('statTime').textContent = tick.t.toFixed(1) + ' s';
    $('statSpeed').textContent = tick.realtime.toFixed(2);
    $('statRate').textContent = fmt(tick.spikesPerSec);
    this.status(`${fmt(tick.active)} near threshold`, tick.realtime > 0.8 ? 'ok' : 'warn');

    for (const k in this.meters) {
      const m = this.meters[k], val = motor.command[k];
      if (m.bi) {
        const w = Math.abs(val) * 50;
        m.bar.style.left = (val >= 0 ? 50 - w : 50) + '%';
        m.bar.style.width = w + '%';
        m.num.textContent = (val >= 0 ? 'L ' : 'R ') + Math.abs(val).toFixed(2);
      } else {
        m.bar.style.width = (val * 100).toFixed(1) + '%';
        m.num.textContent = val.toFixed(2);
      }
    }

    for (const key in this.groupEls) {
      const r = tick.rates[key] ?? 0;
      const h = this.history[key];
      h.push(motor.smoothed[key] ?? r);
      if (h.length > 60) h.shift();
      const el = this.groupEls[key];
      if (!this.visible(el.spark)) continue;
      el.num.textContent = (motor.smoothed[key] ?? r).toFixed(1);
      const c = el.spark, ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      const max = Math.max(20, ...h);
      ctx.strokeStyle = key.startsWith('m:') ? MOTOR_COLOR : STIM_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      h.forEach((y, i) => { const px = (i / 59) * c.width, py = c.height - 2 - (y / max) * (c.height - 4); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
      ctx.stroke();
    }

    // raster (scrolling: shift by elapsed time, draw only the new spikes)
    if (this.visible(this.raster)) this.drawRaster(tick.t, tick.raster);
    if (this.visible(this.classCanvas)) this.drawClasses(tick.classes);
  }

  /** is this element on screen? (unknown = yes; the observer fills it in) */
  visible(el) {
    if (!this.io) return true;
    if (!this.onScreen.has(el)) { this.io.observe(el); this.onScreen.set(el, true); }
    return this.onScreen.get(el);
  }

  drawRaster(tNow, ev) {
    const c = this.raster, ctx = c.getContext('2d');
    const W = c.width, H = c.height, rows = this.rows || 200, fixed = this.fixedRows?.length || 0;
    const rh = H / rows, pxPerSec = W / RASTER_WINDOW;
    if (this.rasterT === undefined || tNow < this.rasterT || tNow - this.rasterT > RASTER_WINDOW) {
      this.rasterT = tNow;
      ctx.fillStyle = '#0b0b0e'; ctx.fillRect(0, 0, W, H);
    }
    const shift = Math.round((tNow - this.rasterT) * pxPerSec);
    if (shift > 0) {
      ctx.drawImage(c, shift, 0, W - shift, H, 0, 0, W - shift, H);
      ctx.fillStyle = '#0b0b0e'; ctx.fillRect(W - shift, 0, shift, H);
      // bands for tagged rows in the new strip
      const tags = this.fixedRows || [];
      for (let r = 0; r < tags.length; r++) {
        ctx.fillStyle = tags[r].startsWith('m:') ? '#e0263a14' : '#58d68d10';
        ctx.fillRect(W - shift, r * rh, shift, rh);
      }
      ctx.fillStyle = '#2a2a33'; ctx.fillRect(W - shift, fixed * rh, shift, 1);
      this.rasterT += shift / pxPerSec;
    }
    const pw = Math.max(1.5, devicePixelRatio * 1.2);
    const tags = this.fixedRows || [];
    for (let i = 0; i < ev.length; i += 3) {
      const row = ev[i], x = W - (this.rasterT - ev[i + 1] / 1000) * pxPerSec;
      if (x < 0) continue;
      const tag = row < fixed ? tags[row] : null;
      ctx.fillStyle = tag ? (tag.startsWith('m:') ? MOTOR_COLOR : STIM_COLOR) : (CLASS_COLORS[this.classes[ev[i + 2]]] || '#aaa');
      ctx.fillRect(x, row * rh, pw, Math.max(1, rh - 0.5));
    }
  }

  drawClasses(counts) {
    const c = this.classCanvas, ctx = c.getContext('2d');
    const W = c.width, H = c.height;
    ctx.clearRect(0, 0, W, H);
    this.classEma = this.classEma || counts.map(() => 0);
    counts.forEach((n, i) => { this.classEma[i] += (n - this.classEma[i]) * 0.2; });
    const max = Math.max(10, ...this.classEma);
    const n = counts.length, bh = H / n;
    ctx.font = `${10 * devicePixelRatio}px system-ui`;
    this.classes.forEach((name, i) => {
      const w = (Math.log1p(this.classEma[i]) / Math.log1p(max)) * (W * 0.62);
      ctx.fillStyle = CLASS_COLORS[name] || '#aaa';
      ctx.fillRect(W * 0.34, i * bh + 2, w, bh - 4);
      ctx.fillStyle = '#8d8a96';
      ctx.fillText(name.replace('_', ' '), 2, i * bh + bh * 0.7);
    });
  }
}
