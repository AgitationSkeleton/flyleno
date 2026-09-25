// Synthesised show sounds for the Grey Leno Show segments (frog, car, UFO, chants, band stings).
// Everything plays into AudioWorld's in-world bus, so the fly hears it through its Johnston's organ like
// any other stage sound (js/hearing.js).
const rand = (a, b) => a + Math.random() * (b - a);

export class ShowSfx {
  constructor(audio) { this.audio = audio; }

  get ctx() { return this.audio.ctx; }

  out(gain = 1, pan = 0) {
    const ctx = this.ctx, g = ctx.createGain(), p = ctx.createStereoPanner();
    g.gain.value = gain; p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(this.audio.bus);
    return g;
  }

  noise() { const n = this.ctx.createBufferSource(); n.buffer = this.audio.noise; n.loop = true; return n; }

  env(param, t, a, peak, hold, rel) {
    param.setValueAtTime(0.0001, t); param.exponentialRampToValueAtTime(peak, t + a);
    param.setValueAtTime(peak, t + a + hold); param.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
  }

  /** a frog's croak: a buzzy pulse train through a throat resonance */
  croak({ gain = 0.8, pan = 0, pitch = 1 } = {}) {
    if (!this.ctx) return 0;
    const ctx = this.ctx, t = ctx.currentTime, dur = rand(0.35, 0.55);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 180 * pitch;
    o.frequency.linearRampToValueAtTime(140 * pitch, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520 * pitch; bp.Q.value = 5;
    const am = ctx.createGain(); am.gain.value = 0;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = rand(22, 30);
    const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
    const out = this.out(gain, pan);
    o.connect(bp).connect(am).connect(out);
    this.env(out.gain, t, 0.02, gain, dur - 0.1, 0.08);
    o.start(t); lfo.start(t); o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
    return dur;
  }

  /** a sticky tongue flicking out */
  thwip({ gain = 0.7, pan = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(600, t); bp.frequency.exponentialRampToValueAtTime(4000, t + 0.08);
    const out = this.out(gain, pan); n.connect(bp).connect(out);
    this.env(out.gain, t, 0.005, gain, 0.04, 0.06);
    n.start(t); n.stop(t + 0.15);
  }

  /** a running engine: returns { set(rpm 0..1, gain), stop() } */
  engine() {
    if (!this.ctx) return { set() {}, stop() {} };
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 38;
    const sub = ctx.createOscillator(); sub.type = 'square'; sub.frequency.value = 19;
    const n = this.noise(); const nl = ctx.createBiquadFilter(); nl.type = 'lowpass'; nl.frequency.value = 400;
    const ng = ctx.createGain(); ng.gain.value = 0.25;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 2;
    const sg = ctx.createGain(); sg.gain.value = 0.6;
    const out = this.out(0.0001);
    o.connect(lp); sub.connect(sg).connect(lp); n.connect(nl).connect(ng).connect(lp); lp.connect(out);
    out.gain.exponentialRampToValueAtTime(0.5, t + 0.6);
    o.start(t); sub.start(t); n.start(t, Math.random());
    return {
      set: (rpm, gain = 0.5) => {
        const now = ctx.currentTime;
        o.frequency.setTargetAtTime(32 + 40 * rpm, now, 0.2); sub.frequency.setTargetAtTime(16 + 20 * rpm, now, 0.2);
        lp.frequency.setTargetAtTime(380 + 700 * rpm, now, 0.2);
        out.gain.setTargetAtTime(Math.max(0.0001, gain), now, 0.15);
      },
      stop: () => {
        const now = ctx.currentTime;
        out.gain.setTargetAtTime(0.0001, now, 0.3);
        o.stop(now + 1.5); sub.stop(now + 1.5); n.stop(now + 1.5);
      },
    };
  }

  /** "a-oo-gah" horn of an old car */
  horn({ gain = 0.7, pan = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, dur = 0.75;
    const out = this.out(gain, pan);
    for (const mul of [1, 1.26]) {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(170 * mul, t); o.frequency.exponentialRampToValueAtTime(330 * mul, t + 0.28);
      o.frequency.setValueAtTime(330 * mul, t + 0.45); o.frequency.exponentialRampToValueAtTime(260 * mul, t + dur);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
      o.connect(bp).connect(out); o.start(t); o.stop(t + dur + 0.05);
    }
    this.env(out.gain, t, 0.02, gain * 0.5, dur - 0.12, 0.1);
  }

  /** the flying saucer's warbling hum: returns { stop() } */
  ufo({ gain = 0.5 } = {}) {
    if (!this.ctx) return { stop() {} };
    const ctx = this.ctx, t = ctx.currentTime, out = this.out(0.0001);
    const a = ctx.createOscillator(); a.type = 'sine'; a.frequency.value = 520;
    const vib = ctx.createOscillator(); vib.frequency.value = 6; const vg = ctx.createGain(); vg.gain.value = 60;
    vib.connect(vg).connect(a.frequency);
    const hum = ctx.createOscillator(); hum.type = 'triangle'; hum.frequency.value = 58;
    const hg = ctx.createGain(); hg.gain.value = 0.9;
    const swell = ctx.createOscillator(); swell.frequency.value = 0.35; const sw = ctx.createGain(); sw.gain.value = 180;
    swell.connect(sw).connect(a.frequency);
    a.connect(out); hum.connect(hg).connect(out);
    out.gain.exponentialRampToValueAtTime(gain, t + 1.5);
    [a, vib, hum, swell].forEach((o) => o.start(t));
    return { stop: () => { const now = ctx.currentTime; out.gain.setTargetAtTime(0.0001, now, 0.5); [a, vib, hum, swell].forEach((o) => o.stop(now + 3)); } };
  }

  /** the crowd chanting a two-syllable name ("LE-NO! LE-NO!") with claps, `n` times */
  chant({ n = 6, gain = 0.6, period = 0.9, vowels = [[530, 1840], [570, 840]] } = {}) {
    if (!this.ctx) return 0;
    const ctx = this.ctx, t0 = ctx.currentTime + 0.05, out = this.out(gain);
    for (let k = 0; k < n; k++) {
      const tb = t0 + k * period;
      vowels.forEach(([f1, f2], s) => {
        const ts = tb + s * period * 0.4, d = period * 0.33;
        for (let v = 0; v < 9; v++) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = rand(110, 230) * (s ? 0.9 : 1);
          const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = f1 * rand(0.92, 1.1); b1.Q.value = 4;
          const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = f2 * rand(0.92, 1.1); b2.Q.value = 5;
          const g = ctx.createGain(), st = ts + rand(0, 0.05);
          o.connect(b1).connect(g); o.connect(b2).connect(g); g.connect(out);
          this.env(g.gain, st, 0.03, 0.09, d * 0.6, d * 0.4);
          o.start(st); o.stop(st + d + 0.1);
        }
      });
      this.claps(tb + period * 0.8, 1, gain * 0.9, out);
    }
    return n * period;
  }

  /** dance-party beat (four on the floor, hats, claps on 2 and 4): returns { stop() } */
  beat({ bpm = 124, gain = 0.6 } = {}) {
    if (!this.ctx) return { stop() {} };
    const ctx = this.ctx, out = this.out(gain), spb = 60 / bpm;
    let next = ctx.currentTime + 0.05, n = 0, alive = true;
    const sched = () => {
      if (!alive) return;
      while (next < ctx.currentTime + 0.3) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(140, next); o.frequency.exponentialRampToValueAtTime(45, next + 0.12);
        const g = ctx.createGain(); o.connect(g).connect(out); this.env(g.gain, next, 0.003, 0.9, 0.02, 0.18);
        o.start(next); o.stop(next + 0.25);
        const h = ctx.createBufferSource(); h.buffer = this.audio.noise; const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 8000;
        const hg = ctx.createGain(); h.connect(hp).connect(hg).connect(out); const th = next + spb / 2;
        this.env(hg.gain, th, 0.002, 0.25, 0.01, 0.04); h.start(th, Math.random()); h.stop(th + 0.08);
        if (n % 2 === 1) this.claps(next, 1, 0.8, out);
        next += spb; n++;
      }
      setTimeout(sched, 100);
    };
    sched();
    return { stop: () => { alive = false; out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.2); } };
  }

  /** steady rain: returns { set(level 0..1), stop() } */
  rain() {
    if (!this.ctx) return { set() {}, stop() {} };
    const ctx = this.ctx, out = this.out(0.0001), n = this.noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
    n.connect(bp).connect(lp).connect(out); n.start(ctx.currentTime, Math.random());
    return {
      set: (lv) => out.gain.setTargetAtTime(Math.max(0.0001, 0.22 * lv), ctx.currentTime, 0.3),
      stop: () => { out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.5); n.stop(ctx.currentTime + 3); },
    };
  }

  /** the audience sings Happy Birthday ("la la la"), then claps; returns its length in s */
  birthday({ gain = 0.55 } = {}) {
    if (!this.ctx) return 0;
    const ctx = this.ctx, out = this.out(gain), beat = 0.42, t0 = ctx.currentTime + 0.1;
    const G4 = 392, A4 = 440, B4 = 494, C5 = 523, D5 = 587, E5 = 659, F5 = 698, G5 = 784;
    const tune = [[G4, 0.75], [G4, 0.25], [A4, 1], [G4, 1], [C5, 1], [B4, 2], [G4, 0.75], [G4, 0.25], [A4, 1], [G4, 1], [D5, 1], [C5, 2],
      [G4, 0.75], [G4, 0.25], [G5, 1], [E5, 1], [C5, 1], [B4, 1], [A4, 2], [F5, 0.75], [F5, 0.25], [E5, 1], [C5, 1], [D5, 1], [C5, 2.5]];
    let tt = t0;
    for (const [f, b] of tune) {
      const d = b * beat;
      for (let v = 0; v < 7; v++) {                               // a room full of slightly out-of-tune voices, "laa"
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (v % 3 === 0 ? 0.5 : 1) * rand(0.985, 1.015);
        const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 750 * rand(0.92, 1.08); b1.Q.value = 3;
        const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 1150 * rand(0.92, 1.08); b2.Q.value = 4;
        const g = ctx.createGain(), st = tt + rand(0, 0.04);
        o.connect(b1).connect(g); o.connect(b2).connect(g); g.connect(out);
        this.env(g.gain, st, 0.05, 0.06, Math.max(0.05, d - 0.15), 0.1);
        o.start(st); o.stop(st + d + 0.2);
      }
      tt += d;
    }
    this.claps(tt + 0.2, 4, gain, out);
    return tt - t0 + 2;
  }

  /** a music-box lullaby (Brahms' Wiegenlied), looped for `dur` seconds: returns { stop() } */
  musicBox({ dur = 28, gain = 0.5 } = {}) {
    if (!this.ctx) return { stop() {} };
    const ctx = this.ctx, out = this.out(gain), beat = 0.42;
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const tune = [[64, 0.5], [64, 0.5], [67, 1.5], [64, 0.5], [64, 0.5], [67, 1.5], [64, 0.5], [67, 0.5], [72, 1], [71, 1], [69, 1], [69, 1], [67, 2],
      [62, 0.5], [64, 0.5], [65, 1], [62, 1], [62, 0.5], [64, 0.5], [65, 2], [62, 0.5], [65, 0.5], [71, 0.5], [69, 0.5], [67, 1], [71, 1], [72, 3]];
    let tt = ctx.currentTime + 0.1;
    const end = tt + dur, nodes = [];
    while (tt < end - 1) {
      for (const [m, b] of tune) {
        if (tt >= end - 1) break;
        for (const [mul, type, amp] of [[2, 'sine', 0.22], [4, 'triangle', 0.05]]) {        // a plucked comb: bright, then a long fade
          const o = ctx.createOscillator(); o.type = type; o.frequency.value = midi(m) * mul / 2;
          const g = ctx.createGain(); o.connect(g).connect(out);
          g.gain.setValueAtTime(0.0001, tt); g.gain.exponentialRampToValueAtTime(amp, tt + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, tt + 1.6);
          o.start(tt); o.stop(tt + 1.7); nodes.push(o);
        }
        tt += b * beat;
      }
    }
    return { stop: () => { out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4); } };
  }

  /** a snare drum roll that builds while it runs: returns { stop() }. Uses the stock recording (a long, even roll by
   *  the US Air Force Band, public domain), from a random point in it; synthesised if the sound bank lacks it */
  drumroll({ gain = 0.45 } = {}) {
    if (!this.ctx) return { stop() {} };
    const long = (this.audio.clips('sfx', 'drumroll') || []).filter((c) => c.dur > 10);
    if (long.length) {
      const ctx = this.ctx, out = this.out(0.0001), t0 = ctx.currentTime;
      out.gain.setValueAtTime(0.0001, t0); out.gain.exponentialRampToValueAtTime(gain * 0.45, t0 + 0.3);
      out.gain.linearRampToValueAtTime(gain, t0 + 6);                        // crescendo
      let src = null, stopped = false;
      this.audio.load(long[(Math.random() * long.length) | 0].file).then((buf) => {
        if (!buf || stopped) return;
        src = ctx.createBufferSource(); src.buffer = buf; src.connect(out);
        src.start(ctx.currentTime, Math.random() * Math.max(0, buf.duration - 12));
      });
      return { stop: () => { stopped = true; const now = ctx.currentTime; out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0.0001, now, 0.04); try { src?.stop(now + 0.3); } catch { /* not started */ } } };
    }
    const ctx = this.ctx, out = this.out(0.0001), t0 = ctx.currentTime;
    out.gain.setValueAtTime(0.0001, t0); out.gain.exponentialRampToValueAtTime(gain * 0.35, t0 + 0.2);
    out.gain.linearRampToValueAtTime(gain, t0 + 6);                        // crescendo
    let next = t0 + 0.03, alive = true, k = 0;
    const sched = () => {
      if (!alive) return;
      while (next < ctx.currentTime + 0.25) {
        const s = ctx.createBufferSource(); s.buffer = this.audio.noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(1600, 2600); bp.Q.value = 0.9;
        const g = ctx.createGain(); s.connect(bp).connect(g).connect(out);
        this.env(g.gain, next, 0.002, (k % 2 ? 0.55 : 0.75) * rand(0.85, 1.1), 0.004, 0.05);
        s.start(next, Math.random()); s.stop(next + 0.08);
        next += (1 / 17) * rand(0.92, 1.08); k++;
      }
      setTimeout(sched, 80);
    };
    sched();
    return { stop: () => { alive = false; const now = ctx.currentTime; out.gain.cancelScheduledValues(now); out.gain.setTargetAtTime(0.0001, now, 0.04); } };
  }

  /** circus music: an original calliope oom-pah tune (bass on the beat, chord stabs off it, a chromatic melody),
   *  looped: returns { stop() } */
  circus({ gain = 0.3 } = {}) {
    if (!this.ctx) return { stop() {} };
    const ctx = this.ctx, out = this.out(gain), e = 60 / 150 / 2;           // an eighth note at 150 bpm
    const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.connect(out);
    const C = [60, 64, 67], G7 = [59, 62, 65];
    const bars = [[36, 43, C, [67, 66, 67, 64]], [36, 43, C, [65, 64, 65, 62]], [31, 38, G7, [64, 63, 64, 60]], [31, 38, G7, [62, 61, 62, 59]],
      [36, 43, C, [60, 64, 67, 72]], [36, 43, C, [71, 72, 74, 72]], [31, 38, G7, [71, 69, 67, 65]], [36, 43, C, [64, 62, 60, null]]];
    const note = (f, t, dur, type, amp, dest) => {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = f;
      const g = ctx.createGain(); o.connect(g).connect(dest); this.env(g.gain, t, 0.005, amp, dur * 0.45, dur * 0.4);
      o.start(t); o.stop(t + dur + 0.05);
    };
    let next = ctx.currentTime + 0.05, bar = 0, alive = true;
    const sched = () => {
      if (!alive) return;
      while (next < ctx.currentTime + 0.4) {
        const [root, fifth, chord, mel] = bars[bar % bars.length];
        note(midi(root), next, e * 1.5, 'sawtooth', 0.5, lp);                       // oom
        note(midi(fifth), next + 2 * e, e * 1.5, 'sawtooth', 0.45, lp);             // pah
        for (const b of [1, 3]) for (const m of chord) note(midi(m), next + b * e, e * 0.6, 'triangle', 0.05, out);
        mel.forEach((m, i) => { if (m) { note(midi(m + 12), next + i * e, e * 0.9, 'square', 0.035, out); note(midi(m + 24), next + i * e, e * 0.9, 'sine', 0.03, out); } });
        next += 4 * e; bar++;
      }
      setTimeout(sched, 120);
    };
    sched();
    return { stop: () => { alive = false; out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); } };
  }

  /** one squeeze-bulb honk (a clown's footsteps); pitch multiplies the frequency */
  honk({ gain = 0.3, pitch = 1, pan = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, out = this.out(gain, pan);
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(430 * pitch, t); o.frequency.exponentialRampToValueAtTime(350 * pitch, t + 0.14);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950 * pitch; bp.Q.value = 2.5;
    const g = ctx.createGain(); o.connect(bp).connect(g).connect(out); this.env(g.gain, t, 0.008, 0.9, 0.09, 0.05);
    o.start(t); o.stop(t + 0.18);
  }

  /** microphone feedback: a squeal that swells and dies away */
  feedback({ gain = 0.5 } = {}) {
    if (!this.ctx) return 0;
    if (this.audio.clips('sfx', 'micfeedback')?.length) return this.audio.sfx('micfeedback', { gain });   // stock recordings
    gain *= 0.18;
    const ctx = this.ctx, t = ctx.currentTime, f = rand(1900, 3200), dur = rand(0.5, 0.9), out = this.out(0.0001);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 1.03, t + dur);
    const vib = ctx.createOscillator(); vib.frequency.value = 7; const vg = ctx.createGain(); vg.gain.value = f * 0.006;
    vib.connect(vg).connect(o.frequency);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.01; const g2 = ctx.createGain(); g2.gain.value = 0.25;
    o.connect(out); o2.connect(g2).connect(out);
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(gain, t + dur * 0.65); out.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.2);
    for (const x of [o, o2, vib]) { x.start(t); x.stop(t + dur + 0.25); }
    return dur;
  }

  claps(t, n = 1, gain = 0.5, dest = null) {
    const ctx = this.ctx, out = dest || this.out(gain);
    for (let k = 0; k < n; k++) for (let v = 0; v < 12; v++) {
      const s = ctx.createBufferSource(); s.buffer = this.audio.noise;
      const hp = ctx.createBiquadFilter(); hp.type = 'bandpass'; hp.frequency.value = rand(900, 1800); hp.Q.value = 1.5;
      const g = ctx.createGain(), st = t + k * 0.5 + rand(0, 0.06);
      s.connect(hp).connect(g).connect(out);
      this.env(g.gain, st, 0.003, 0.25 * gain, 0.005, 0.05);
      s.start(st, Math.random()); s.stop(st + 0.1);
    }
  }

  /** one-shots: 'rimshot' (ba-dum-tss), 'fanfare' (sponsor sting), 'crickets' (awkward silence), 'ring' (phone),
   *  'caller' (voice on the line), 'static' (TV hiss), 'pop' (confetti cannon) */
  sting(kind, { gain = 0.7 } = {}) {
    if (!this.ctx) return 0;
    // stock recordings where the sound bank has them: rimshots, and a short crescendo roll ('rollup')
    if (kind === 'rimshot' && this.audio.clips('sfx', 'rimshot')?.length) return this.audio.sfx('rimshot', { gain: gain * 1.3 });
    if (kind === 'rollup') {
      const short = (this.audio.clips('sfx', 'drumroll') || []).filter((c) => c.dur <= 10);
      return short.length ? this.audio.playClip(short[(Math.random() * short.length) | 0], { gain }) : 0;
    }
    const ctx = this.ctx, t = ctx.currentTime, out = this.out(gain);
    if (kind === 'rimshot') {
      [[0, 190], [0.16, 130]].forEach(([dt, f]) => {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(f * 1.6, t + dt); o.frequency.exponentialRampToValueAtTime(f, t + dt + 0.12);
        const g = ctx.createGain(); o.connect(g).connect(out); this.env(g.gain, t + dt, 0.004, 0.9, 0.02, 0.2);
        o.start(t + dt); o.stop(t + dt + 0.3);
      });
      const n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000;
      const g = ctx.createGain(); n.connect(hp).connect(g).connect(out);
      this.env(g.gain, t + 0.36, 0.004, 0.6, 0.05, 0.9); n.start(t + 0.36); n.stop(t + 1.4);
      return 1.4;
    }
    if (kind === 'fanfare') {
      [[0, [392, 494, 587]], [0.22, [392, 494, 587]], [0.44, [523, 659, 784]]].forEach(([dt, chord], i) => {
        for (const f of chord) {
          const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
          const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
          const g = ctx.createGain(); o.connect(lp).connect(g).connect(out);
          this.env(g.gain, t + dt, 0.02, 0.12, i === 2 ? 0.7 : 0.1, 0.12);
          o.start(t + dt); o.stop(t + dt + (i === 2 ? 1 : 0.3));
        }
      });
      return 1.3;
    }
    if (kind === 'crickets') {
      for (let k = 0; k < 7; k++) {
        const st = t + k * 0.42 + rand(0, 0.05);
        for (let p = 0; p < 3; p++) {
          const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 4400 + rand(-100, 100);
          const g = ctx.createGain(); o.connect(g).connect(out);
          const tp = st + p * 0.045; this.env(g.gain, tp, 0.004, 0.18, 0.015, 0.02);
          o.start(tp); o.stop(tp + 0.05);
        }
      }
      return 3;
    }
    if (kind === 'ring') {                                    // an old phone: two rings
      for (let r = 0; r < 2; r++) for (const f of [440, 480]) {
        const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
        const am = ctx.createGain(); const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 20;
        const lg = ctx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(am.gain);
        const g = ctx.createGain(); o.connect(am).connect(g).connect(out);
        const st = t + r * 1.6; this.env(g.gain, st, 0.01, 0.35, 0.9, 0.05);
        o.start(st); lfo.start(st); o.stop(st + 1); lfo.stop(st + 1);
      }
      return 3;
    }
    if (kind === 'caller') {                                  // a garbled voice down a phone line (300-3400 Hz)
      const dur = 3.2, o = ctx.createOscillator(); o.type = 'sawtooth';
      for (let k = 0; k < 14; k++) o.frequency.setValueAtTime(rand(150, 260), t + k * dur / 14);
      const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.Q.value = 5;
      for (let k = 0; k < 20; k++) f1.frequency.setValueAtTime(rand(400, 1800), t + k * dur / 20);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 300;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
      const g = ctx.createGain(); o.connect(f1).connect(hp).connect(lp).connect(g).connect(out);
      g.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 16; k++) { const st = t + k * dur / 16; g.gain.setValueAtTime(Math.random() < 0.8 ? 0.6 : 0.0001, st); }
      g.gain.setValueAtTime(0.0001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
      return dur;
    }
    if (kind === 'static') {                                  // TV static hiss
      const n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
      n.connect(hp).connect(out); this.env(out.gain, t, 0.05, gain * 0.04, 6.5, 0.4);   // quiet: white noise is loud
      n.start(t); n.stop(t + 7.1);
      return 7;
    }
    if (kind === 'skitter') {                                 // eight legs clicking
      for (let k = 0; k < 14; k++) {
        const st = t + k * rand(0.035, 0.07), n = ctx.createBufferSource(); n.buffer = this.audio.noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(2500, 5000); bp.Q.value = 8;
        const g = ctx.createGain(); n.connect(bp).connect(g).connect(out);
        this.env(g.gain, st, 0.002, 0.5, 0.004, 0.02); n.start(st, Math.random()); n.stop(st + 0.04);
      }
      return 0.8;
    }
    if (kind === 'whoosh') {                                  // a swing through the air
      const n = this.noise(), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
      bp.frequency.setValueAtTime(400, t); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.16); bp.frequency.exponentialRampToValueAtTime(600, t + 0.3);
      n.connect(bp).connect(out); this.env(out.gain, t, 0.08, gain * 0.7, 0.05, 0.15);
      n.start(t); n.stop(t + 0.35);
      return 0.3;
    }
    if (kind === 'thwack') {                                  // swatter slap
      const n = this.noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3000;
      n.connect(lp).connect(out); this.env(out.gain, t, 0.001, gain, 0.01, 0.09);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.1);
      const og = ctx.createGain(); o.connect(og).connect(out); this.env(og.gain, t, 0.001, 0.8, 0.01, 0.1);
      n.start(t); n.stop(t + 0.15); o.start(t); o.stop(t + 0.15);
      return 0.15;
    }
    if (kind === 'zap') {                                     // electric racket: crackle + mains buzz
      const dur = 0.55, n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
      const cg = ctx.createGain(); n.connect(hp).connect(cg).connect(out);
      cg.gain.setValueAtTime(0.0001, t);
      for (let k = 0; k < 22; k++) cg.gain.setValueAtTime(Math.random() < 0.6 ? 0.7 : 0.05, t + k * dur / 22);
      cg.gain.setValueAtTime(0.0001, t + dur);
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 120;
      const og = ctx.createGain(); o.connect(og).connect(out); this.env(og.gain, t, 0.005, 0.35, dur - 0.1, 0.08);
      n.start(t, Math.random()); n.stop(t + dur + 0.05); o.start(t); o.stop(t + dur + 0.05);
      return dur;
    }
    if (kind === 'trumpet') {                                 // the last trumpet: a long brass call, then a choir swells
      const notes = [[392, 0, 0.9], [523, 0.95, 0.5], [659, 1.5, 0.5], [784, 2.05, 2.6]];
      for (const [f, dt, d] of notes) for (const det of [1, 1.004, 0.997]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * det;
        const vib = ctx.createOscillator(); vib.frequency.value = 5.5; const vg = ctx.createGain(); vg.gain.value = f * 0.008;
        vib.connect(vg).connect(o.frequency);
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
        lp.frequency.setValueAtTime(600, t + dt); lp.frequency.linearRampToValueAtTime(3200, t + dt + 0.15);
        const g = ctx.createGain(); o.connect(lp).connect(g).connect(out);
        this.env(g.gain, t + dt, 0.06, 0.09, d, 0.35);
        o.start(t + dt); vib.start(t + dt); o.stop(t + dt + d + 0.5); vib.stop(t + dt + d + 0.5);
      }
      for (const f of [196, 247, 294, 392, 494]) {           // "aah"
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
        const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.frequency.value = 800; b1.Q.value = 3;
        const b2 = ctx.createBiquadFilter(); b2.type = 'bandpass'; b2.frequency.value = 1200; b2.Q.value = 4;
        const g = ctx.createGain(); o.connect(b1).connect(g); o.connect(b2).connect(g); g.connect(out);
        this.env(g.gain, t + 1.4, 1.2, 0.06, 3.5, 2); o.start(t + 1.4); o.stop(t + 8.3);
      }
      return 8;
    }
    if (kind === 'cry') {                                     // a baby: "waah"
      const dur = rand(0.6, 1.1), o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(rand(380, 460), t); o.frequency.linearRampToValueAtTime(rand(520, 620), t + dur * 0.35);
      o.frequency.linearRampToValueAtTime(rand(330, 400), t + dur);
      const b1 = ctx.createBiquadFilter(); b1.type = 'bandpass'; b1.Q.value = 5;
      b1.frequency.setValueAtTime(700, t); b1.frequency.linearRampToValueAtTime(1300, t + dur * 0.3);
      const g = ctx.createGain(); o.connect(b1).connect(g).connect(out); this.env(g.gain, t, 0.08, 0.5, dur - 0.2, 0.12);
      o.start(t); o.stop(t + dur + 0.05);
      return dur;
    }
    if (kind === 'powerup') {                                 // rising arpeggio
      [0, 4, 7, 12, 16, 19, 24, 28].forEach((semi, i) => {
        const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 330 * Math.pow(2, semi / 12);
        const g = ctx.createGain(); o.connect(g).connect(out); const st = t + i * 0.06;
        this.env(g.gain, st, 0.005, 0.12, 0.04, 0.03); o.start(st); o.stop(st + 0.1);
      });
      return 0.6;
    }
    if (kind === 'thunder') {
      const n = this.noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
      const g = ctx.createGain(); n.connect(lp).connect(g).connect(out);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.4, t + 0.05);
      for (let k = 1; k < 8; k++) g.gain.setValueAtTime(rand(0.4, 1.3), t + k * 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
      n.start(t, Math.random()); n.stop(t + 2.9);
      return 2.8;
    }
    if (kind === 'crash') {                                   // glass and metal
      for (let k = 0; k < 18; k++) {
        const st = t + rand(0, 0.35), o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = rand(2500, 7000);
        const g = ctx.createGain(); o.connect(g).connect(out); this.env(g.gain, st, 0.002, 0.12, 0.01, rand(0.05, 0.25));
        o.start(st); o.stop(st + 0.3);
      }
      const n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
      const g = ctx.createGain(); n.connect(hp).connect(g).connect(out); this.env(g.gain, t, 0.002, 0.5, 0.05, 0.4);
      n.start(t); n.stop(t + 0.5);
      return 0.6;
    }
    if (kind === 'creak') {                                   // a rig letting go
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(90, t); o.frequency.linearRampToValueAtTime(140, t + 0.5);
      const am = ctx.createGain(); const lfo = ctx.createOscillator(); lfo.frequency.value = 30; const lg = ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
      o.connect(bp).connect(am).connect(out); this.env(out.gain, t, 0.05, gain * 0.6, 0.4, 0.1);
      o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
      return 0.6;
    }
    if (kind === 'glitch') {                                  // broken-cartridge chiptune garble
      for (let k = 0; k < 40; k++) {
        const st = t + k * rand(0.03, 0.09), o = ctx.createOscillator(); o.type = Math.random() < 0.5 ? 'square' : 'triangle';
        o.frequency.value = [110, 220, 330, 440, 660, 880, 1320, 1760][(Math.random() * 8) | 0] * (Math.random() < 0.3 ? 1.06 : 1);
        const g = ctx.createGain(); o.connect(g).connect(out); this.env(g.gain, st, 0.002, 0.18 * (1 - k / 45), 0.03, 0.02);
        o.start(st); o.stop(st + 0.07);
      }
      return 2.5;
    }
    if (kind === 'gunshot') {                                 // a revolver: a sharp crack, a boom, the room ringing
      const n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const g = ctx.createGain(); n.connect(hp).connect(g).connect(out); this.env(g.gain, t, 0.0008, 1.2, 0.004, 0.09);
      const n2 = this.noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      const g2 = ctx.createGain(); n2.connect(lp).connect(g2).connect(out); this.env(g2.gain, t, 0.002, 1.1, 0.02, 0.35);
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.2);
      const og = ctx.createGain(); o.connect(og).connect(out); this.env(og.gain, t, 0.002, 0.9, 0.01, 0.22);
      if (this.audio.reverb) { const r = ctx.createGain(); r.gain.value = 0.45; out.connect(r).connect(this.audio.reverb); }
      n.start(t, Math.random()); n.stop(t + 0.15); n2.start(t, Math.random()); n2.stop(t + 0.5); o.start(t); o.stop(t + 0.3);
      return 0.6;
    }
    if (kind === 'bang') {                                    // a toy cap gun: a sharp pop, then a comic boing
      const n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1200;
      const g = ctx.createGain(); n.connect(hp).connect(g).connect(out); this.env(g.gain, t, 0.001, 1, 0.01, 0.08);
      n.start(t, Math.random()); n.stop(t + 0.12);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(220, t + 0.05); o.frequency.exponentialRampToValueAtTime(700, t + 0.3);
      const vib = ctx.createOscillator(); vib.frequency.value = 14; const vg = ctx.createGain(); vg.gain.value = 40; vib.connect(vg).connect(o.frequency);
      const og = ctx.createGain(); o.connect(og).connect(out); this.env(og.gain, t + 0.05, 0.01, 0.35, 0.2, 0.25);
      o.start(t + 0.05); vib.start(t + 0.05); o.stop(t + 0.6); vib.stop(t + 0.6);
      return 0.6;
    }
    if (kind === 'cackle') {                                  // a maniacal "ha-ha-ha-ha-HA", rising then falling
      const n = 10;
      for (let k = 0; k < n; k++) {
        const st = t + k * 0.14 * (1 - k * 0.02), f0 = 190 + 90 * Math.sin((k / n) * Math.PI) + rand(-8, 8);
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.08, st); o.frequency.exponentialRampToValueAtTime(f0 * 0.9, st + 0.1);
        const mix = ctx.createGain();
        for (const [f, q, a] of [[760, 6, 1], [1150, 8, 0.6], [2500, 10, 0.3]]) {
          const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q;
          const bg = ctx.createGain(); bg.gain.value = a * 2.2; o.connect(b).connect(bg).connect(mix);
        }
        const h = this.noise(), hb = ctx.createBiquadFilter(); hb.type = 'bandpass'; hb.frequency.value = 1500; hb.Q.value = 1;
        const hg = ctx.createGain(); h.connect(hb).connect(hg).connect(mix); this.env(hg.gain, st, 0.005, 0.25, 0.01, 0.02);
        mix.connect(out); this.env(mix.gain, st, 0.012, 0.3 * (1 - k / (n * 1.6)), 0.05, 0.05);
        o.start(st); o.stop(st + 0.14); h.start(st, Math.random()); h.stop(st + 0.05);
      }
      return n * 0.14;
    }
    if (kind === 'clownhorn') {                               // a squeeze-bulb horn: honk honk
      for (const dt of [0, 0.26]) {
        const o = ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(430, t + dt); o.frequency.exponentialRampToValueAtTime(350, t + dt + 0.17);
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 2.5;
        const g = ctx.createGain(); o.connect(bp).connect(g).connect(out); this.env(g.gain, t + dt, 0.01, 0.9, 0.12, 0.05);
        o.start(t + dt); o.stop(t + dt + 0.2);
      }
      return 0.5;
    }
    if (kind === 'cymbal') {                                  // a crash cymbal
      const n = this.noise(), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000;
      const sh = ctx.createBiquadFilter(); sh.type = 'peaking'; sh.frequency.value = 9000; sh.gain.value = 6;
      const g = ctx.createGain(); n.connect(hp).connect(sh).connect(g).connect(out);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      n.start(t, Math.random()); n.stop(t + 1.9);
      return 1.8;
    }
    if (kind === 'mictap') {                                  // tap, tap on the microphone
      for (const dt of [0, 0.38]) {
        const o = ctx.createOscillator(); o.type = 'sine';
        o.frequency.setValueAtTime(95, t + dt); o.frequency.exponentialRampToValueAtTime(40, t + dt + 0.09);
        const g = ctx.createGain(); o.connect(g).connect(out); this.env(g.gain, t + dt, 0.002, 0.9, 0.01, 0.1);
        o.start(t + dt); o.stop(t + dt + 0.15);
        const n = this.noise(), lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
        const ng = ctx.createGain(); n.connect(lp).connect(ng).connect(out); this.env(ng.gain, t + dt, 0.001, 0.4, 0.005, 0.03);
        n.start(t + dt, Math.random()); n.stop(t + dt + 0.05);
      }
      return 0.6;
    }
    if (kind === 'wheel') {                                   // a prize wheel's pointer clicking over the pegs, slowing down
      const spin = 6.5, F = Math.PI * 5, wedge = Math.PI / 4;
      for (let k = 1; k * wedge < F; k++) {
        const st = t + spin * (1 - Math.sqrt(1 - (k * wedge) / F));
        const n = ctx.createBufferSource(); n.buffer = this.audio.noise;
        const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2800; bp.Q.value = 6;
        const g = ctx.createGain(); n.connect(bp).connect(g).connect(out);
        this.env(g.gain, st, 0.001, 0.8, 0.005, 0.03); n.start(st, Math.random()); n.stop(st + 0.05);
      }
      return spin;
    }
    if (kind === 'pop') {
      const n = this.noise(), bp = ctx.createBiquadFilter(); bp.type = 'lowpass'; bp.frequency.value = 2500;
      n.connect(bp).connect(out); this.env(out.gain, t, 0.002, gain, 0.02, 0.25);
      n.start(t); n.stop(t + 0.35);
      return 0.35;
    }
    return 0;
  }
}
