// In-world audio: Leno's voice, body sounds, crowd. Uses the sound bank in assets/audio/manifest.json
// when present (built by tools/audio/, not redistributable), otherwise synthesises everything
// (formant vowels, noise-based SFX and crowd) so a public build still has sound.
// Every sound goes through `this.bus`, which the fly "hears" (see hearing.js).

// Formants (F1, F2, F3 Hz) for ARPAbet vowels, adult male, for the synth fallback.
const FORMANTS = {
  AA: [730, 1090, 2440], AE: [660, 1720, 2410], AH: [640, 1190, 2390], AO: [570, 840, 2410],
  EH: [530, 1840, 2480], ER: [490, 1350, 1690], IH: [390, 1990, 2550], IY: [270, 2290, 3010],
  OW: [450, 900, 2400], UH: [440, 1020, 2240], UW: [300, 870, 2240], AY: [700, 1500, 2500],
  EY: [480, 2000, 2500], OY: [520, 1000, 2400], AW: [680, 1100, 2400],
};
export const VOWELS = Object.keys(FORMANTS);
export const CONSONANTS = ['B', 'D', 'G', 'P', 'T', 'K', 'M', 'N', 'L', 'R', 'S', 'SH', 'F', 'V', 'Z', 'HH', 'W', 'Y'];

const rand = (a, b) => a + Math.random() * (b - a);
// clips unticked on tools/audition.html (same origin) are skipped
let disabled = new Set();
const readDisabled = () => { try { disabled = new Set(JSON.parse(localStorage.getItem('flyleno.disabledClips') || '[]')); } catch { disabled = new Set(); } };
readDisabled();
addEventListener('storage', (e) => { if (e.key === 'flyleno.disabledClips') readDisabled(); });
const pick = (arr) => {
  const ok = arr.filter((c) => !disabled.has(c.file));
  const pool = ok.length ? ok : arr;
  return pool[(Math.random() * pool.length) | 0];
};

export class AudioWorld {
  constructor() {
    this.ctx = null;
    this.bank = null;          // manifest
    this.buffers = new Map();  // file -> AudioBuffer
    this.volume = 0.9;
    this.lenoPitch = 1;        // playback-rate multiplier (mood can shift it)
    // Synthesised placeholders are opt-in (?synth=1); normally only the real sound bank is used.
    this.synth = new URLSearchParams(location.search).has('synth');
  }

  /** Must be called from a user gesture. */
  async start() {
    if (this.ctx) return;
    const ctx = (this.ctx = new AudioContext());
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    this.bus = ctx.createGain();                 // all in-world sound
    this.bus.connect(this.master).connect(ctx.destination);
    // Leno's own sounds go through voiceBus, analysed for lip-sync (mouthOpen)
    this.voiceBus = ctx.createGain();
    this.voiceAnalyser = ctx.createAnalyser(); this.voiceAnalyser.fftSize = 512;
    this.voiceBus.connect(this.voiceAnalyser);
    this.voiceBus.connect(this.bus);
    this._vbuf = new Float32Array(this.voiceAnalyser.fftSize);
    this.noise = this.makeNoise(2);
    await this.reloadBank();
    // the bank may still be growing (tools/audio writes partial manifests): pick up new clips live
    this.bankTimer = setInterval(() => this.reloadBank(), 20000);
  }

  async reloadBank() {
    try {
      const r = await fetch('assets/audio/manifest.json', { cache: 'no-store' });
      if (r.ok) { this.bank = await r.json(); this.preload(); }
    } catch { /* no bank yet */ }
  }

  /** clips for a category, with stand-ins for categories the bank doesn't have (yet) */
  clips(group, kind) {
    const b = this.bank?.[group];
    if (!b) return null;
    if (b[kind]?.length) return b[kind];
    const alias = { crowd: { cheer: 'applause', applause: 'cheer' }, sfx: {} }[group]?.[kind];
    return alias && b[alias]?.length ? b[alias] : null;
  }

  get usingBank() { return !!this.bank; }

  /** 0..1 mouth openness from the loudness of Leno's own sounds right now */
  mouthOpen() {
    if (!this.voiceAnalyser) return 0;
    this.voiceAnalyser.getFloatTimeDomainData(this._vbuf);
    let e = 0; for (const x of this._vbuf) e += x * x;
    const rms = Math.sqrt(e / this._vbuf.length);
    return Math.max(0, Math.min(1, (20 * Math.log10(rms + 1e-6) + 42) / 28));   // -42 dBFS closed .. -14 dBFS wide open
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }

  makeNoise(sec) {
    const b = this.ctx.createBuffer(1, this.ctx.sampleRate * sec, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  preload() {
    const files = [];
    const walk = (o) => {
      if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') { if (o.file) files.push(o.file); else Object.values(o).forEach(walk); }
    };
    walk(this.bank.leno); walk(this.bank.sfx); walk(this.bank.crowd);
    // decode lazily but start fetching everything small
    for (const f of files) this.load(f);
  }

  load(file) {
    if (!this.buffers.has(file)) {
      this.buffers.set(file, fetch('assets/audio/' + file).then((r) => r.arrayBuffer())
        .then((a) => this.ctx.decodeAudioData(a)).catch(() => null));
    }
    return this.buffers.get(file);
  }

  async playClip(clip, { gain = 1, rate = 1, pan = 0, when = 0, voice = false } = {}) {
    const buf = await this.load(clip.file);
    if (!buf) return 0;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = buf; src.playbackRate.value = rate; g.gain.value = gain; p.pan.value = pan;
    src.connect(g).connect(p).connect(voice ? this.voiceBus : this.bus);
    src.start(ctx.currentTime + when);
    return buf.duration / rate;
  }

  // ------------------------------------------------------------------ Leno's voice
  /** Say a phoneme (ARPAbet). Returns its duration in s. */
  phoneme(ph, { pan = 0, gain = 1, stretch = 1 } = {}) {
    if (!this.ctx) return 0;
    const clips = this.bank?.leno?.phonemes?.[ph];
    if (clips?.length) return this.playClip(pick(clips), { gain, pan, rate: this.lenoPitch * rand(0.95, 1.05) / stretch, voice: true });
    return this.synth ? this.synthPhone(ph, { pan, gain, dur: 0.14 * stretch }) : 0;
  }

  mutter(kind = null, { pan = 0, gain = 1 } = {}) {
    if (!this.ctx) return 0;
    const m = this.bank?.leno?.mutters;
    if (m?.length) {
      const pool = kind ? m.filter((x) => x.kind === kind) : m;
      return this.playClip(pick(pool.length ? pool : m), { gain, pan, rate: this.lenoPitch * rand(0.93, 1.07), voice: true });
    }
    // synth: "uhhh"/"hmm" = long AH or M-ish murmur
    return this.synth ? this.synthPhone(kind === 'hmm' ? 'UH' : 'AH', { pan, gain: gain * 0.7, dur: rand(0.25, 0.5) }) : 0;
  }

  word(text, { pan = 0 } = {}) {
    const w = this.bank?.leno?.words?.find((x) => x.text.toLowerCase() === text.toLowerCase());
    return w ? this.playClip(w, { pan, rate: this.lenoPitch, voice: true }) : null;
  }

  synthPhone(ph, { pan = 0, gain = 1, dur = 0.14 } = {}) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan;
    out.connect(p).connect(this.bus);
    const env = (node, a, d, peak) => {
      node.gain.setValueAtTime(0.0001, t);
      node.gain.exponentialRampToValueAtTime(peak, t + a);
      node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    };
    const f = FORMANTS[ph];
    if (f) {
      // raspy alien host: low, slightly wobbly glottal source through 3 formant filters
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const f0 = 92 * this.lenoPitch * rand(0.92, 1.1);
      osc.frequency.setValueAtTime(f0 * 1.06, t); osc.frequency.linearRampToValueAtTime(f0 * 0.94, t + dur);
      const rasp = ctx.createBufferSource(); rasp.buffer = this.noise; const rg = ctx.createGain(); rg.gain.value = 0.25;
      const mix = ctx.createGain(); osc.connect(mix); rasp.connect(rg).connect(mix);
      for (const [k, fr] of f.entries()) {
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = fr; bp.Q.value = 6 + k * 3;
        const g = ctx.createGain(); g.gain.value = [1, 0.6, 0.3][k] * 2.2;
        mix.connect(bp).connect(g).connect(out);
      }
      env(out, 0.015, dur, 0.5 * gain);
      osc.start(t); rasp.start(t, Math.random()); osc.stop(t + dur + 0.05); rasp.stop(t + dur + 0.05);
    } else {
      // consonant: filtered noise burst (+ voiced buzz for voiced consonants)
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
      bp.frequency.value = { S: 6000, SH: 3000, F: 5000, Z: 5500, V: 3000, HH: 1500 }[ph] || 1800; bp.Q.value = 1.2;
      n.connect(bp).connect(out);
      env(out, 0.005, dur * 0.5, 0.35 * gain);
      n.start(t, Math.random()); n.stop(t + dur);
      if ('BDGMNLRVZWY'.includes(ph[0])) {
        const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 95 * this.lenoPitch;
        const og = ctx.createGain(); og.gain.value = 0.4; o.connect(og).connect(out); o.start(t); o.stop(t + dur);
      }
      dur *= 0.6;
    }
    return dur;
  }

  // ------------------------------------------------------------------ body sounds
  sfx(kind, { pan = 0, gain = 1 } = {}) {
    if (!this.ctx) return 0;
    let clips = this.clips('sfx', kind);
    // the longer gagging clips (over ~1.2 s) carry a whole bout of vomiting: they're used when he actually vomits,
    // never for a dry retch
    if (kind === 'retch' && clips) clips = clips.filter((c) => c.dur <= 1.2);
    if (kind === 'vomit') clips = [...(clips || []), ...(this.clips('sfx', 'retch') || []).filter((c) => c.dur > 1.2)];
    const mouthy = ['retch', 'vomit', 'burp'].includes(kind);            // come out of Leno's mouth -> lip-sync
    // gag/vomit SFX are recorded by other people: pitch them down a little toward Leno's low voice
    const rate = mouthy && kind !== 'burp' ? rand(0.82, 0.9) : rand(0.94, 1.06);
    if (clips?.length) return this.playClip(pick(clips), { pan, gain, rate, voice: mouthy });
    if (kind === 'vomit' && this.clips('sfx', 'retch')) {
      // no vomit clips: a heave followed by a splash
      const r = this.playClip(pick(this.clips('sfx', 'retch')), { pan, gain, rate: rand(0.85, 0.95) });
      const sp = this.clips('sfx', 'splat');
      if (sp) Promise.resolve(r).then((d) => this.playClip(pick(sp), { pan, gain: gain * 1.2, rate: 0.8, when: Math.max(0, (d || 0.5) - 0.15) }));
      return r;
    }
    return this.synth ? this.synthSfx(kind, { pan, gain }) : 0;
  }

  synthSfx(kind, { pan = 0, gain = 1 }) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); const p = ctx.createStereoPanner(); p.pan.value = pan; out.connect(p).connect(this.bus);
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    if (kind === 'fart') {
      const dur = rand(0.4, 1.1);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(rand(70, 110), t);
      for (let k = 1; k < 8; k++) o.frequency.linearRampToValueAtTime(rand(45, 120), t + (dur * k) / 8);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 4;
      const am = ctx.createGain(); o.connect(am); n.connect(am);
      am.connect(lp).connect(out);
      out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.9 * gain, t + 0.03);
      out.gain.setValueAtTime(0.9 * gain, t + dur * 0.7); out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.start(t); n.start(t, Math.random()); o.stop(t + dur); n.stop(t + dur);
      return dur;
    }
    // retch / vomit: throaty growl rising, vomit adds a wet splash
    const dur = kind === 'vomit' ? rand(1.2, 1.8) : rand(0.5, 0.9);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(70, t); o.frequency.linearRampToValueAtTime(140, t + dur * 0.6);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 600; bp.Q.value = 1.5;
    const ng = ctx.createGain(); ng.gain.value = 0.8;
    o.connect(bp); n.connect(ng).connect(bp); bp.connect(out);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(0.8 * gain, t + 0.1);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t); n.start(t, Math.random()); o.stop(t + dur); n.stop(t + dur);
    if (kind === 'vomit') {
      const s = ctx.createBufferSource(); s.buffer = this.noise;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
      const sg = ctx.createGain(); s.connect(lp).connect(sg).connect(out);
      sg.gain.setValueAtTime(0.0001, t + dur * 0.55); sg.gain.exponentialRampToValueAtTime(1.2 * gain, t + dur * 0.6);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.3);
      s.start(t + dur * 0.5, Math.random()); s.stop(t + dur * 1.4);
    }
    return dur;
  }

  // ------------------------------------------------------------------ crowd
  crowd(kind, { gain = 1, dur = null } = {}) {
    if (!this.ctx) return 0;
    const clips = this.clips('crowd', kind);
    if (clips?.length) return this.playClip(pick(clips), { gain, rate: rand(0.97, 1.03), pan: rand(-0.2, 0.2) });
    return this.synth ? this.synthCrowd(kind, gain, dur) : 0;
  }

  synthCrowd(kind, gain, dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.connect(this.bus);
    const D = dur ?? { cheer: 2.5, applause: 3, laugh: 2, boo: 2.2, gasp: 0.8 }[kind] ?? 2;
    const voices = kind === 'gasp' ? 10 : 14;
    for (let v = 0; v < voices; v++) {
      const pan = ctx.createStereoPanner(); pan.pan.value = rand(-0.9, 0.9);
      const g = ctx.createGain(); g.connect(pan).connect(out);
      const st = t + rand(0, kind === 'gasp' ? 0.15 : 0.5);
      if (kind === 'boo' || kind === 'cheer' || kind === 'laugh') {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        const base = kind === 'boo' ? rand(95, 170) : rand(180, 320);
        o.frequency.setValueAtTime(base, st);
        if (kind === 'cheer') o.frequency.linearRampToValueAtTime(base * rand(1.1, 1.4), st + D * 0.5);
        const f = FORMANTS[kind === 'boo' ? 'UW' : kind === 'cheer' ? 'EY' : 'AA'];
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f[0] * rand(0.9, 1.2); bp.Q.value = 3;
        o.connect(bp).connect(g);
        g.gain.setValueAtTime(0.0001, st);
        if (kind === 'laugh') {
          for (let k = 0; k < D / 0.18; k++) {
            const tk = st + k * rand(0.15, 0.2);
            g.gain.setValueAtTime(0.0001, tk); g.gain.exponentialRampToValueAtTime(0.12 * gain, tk + 0.03);
            g.gain.exponentialRampToValueAtTime(0.0001, tk + 0.12);
          }
        } else {
          g.gain.exponentialRampToValueAtTime(0.1 * gain, st + 0.25);
          g.gain.exponentialRampToValueAtTime(0.0001, st + D);
        }
        o.start(st); o.stop(st + D + 0.3);
      }
      if (kind === 'cheer' || kind === 'applause' || kind === 'gasp') {
        const n = ctx.createBufferSource(); n.buffer = this.noise;
        const hp = ctx.createBiquadFilter(); hp.type = kind === 'gasp' ? 'bandpass' : 'highpass';
        hp.frequency.value = kind === 'gasp' ? 2500 : 1200;
        const ng = ctx.createGain(); n.connect(hp).connect(ng).connect(pan);
        ng.gain.setValueAtTime(0.0001, st);
        if (kind === 'applause') {
          for (let k = 0; k < D * 9; k++) {
            const tk = st + k / 9 + rand(0, 0.08);
            ng.gain.setValueAtTime(0.0001, tk); ng.gain.exponentialRampToValueAtTime(0.18 * gain, tk + 0.004);
            ng.gain.exponentialRampToValueAtTime(0.0001, tk + 0.05);
          }
        } else {
          ng.gain.exponentialRampToValueAtTime((kind === 'gasp' ? 0.12 : 0.05) * gain, st + (kind === 'gasp' ? 0.2 : 0.3));
          ng.gain.exponentialRampToValueAtTime(0.0001, st + D);
        }
        n.start(st, Math.random()); n.stop(st + D + 0.3);
      }
    }
    return D;
  }
}
