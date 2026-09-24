// Turns the fly's neural activity into Leno's vocal and bodily actions.
//
// Vocal tract (an analogy — flies don't speak):
//   voicing     = song/wing-power descending neurons (DNg02, DNp13) + overall articulator drive
//   vowel       = which pharyngeal-nerve motor neurons (PhN, the throat) fire most
//   consonant   = which mouthpart motor neurons (MxLbN, proboscis/labial) fire most
//   Each articulator neuron is assigned to one phoneme ("motor synergy"); a syllable is emitted every
//   ~150–250 ms while voicing is on. Weak/ambiguous drive gives mutters and stammers.
// Body:
//   retch   = pharyngeal pump neurons (PhN minus MN9) firing while MN9 (feeding) is quiet
//   vomit   = repeated retching within a few seconds (nausea integrator)
//   fart    = oviposition descending neurons (oviDN; abdominal motor command)
import { VOWELS, CONSONANTS } from './audio.js';

const pickMax = (vals) => {
  let b = -1, bi = -1, s = -1, si = -1;
  vals.forEach((v, i) => { if (v > b) { s = b; si = bi; b = v; bi = i; } else if (v > s) { s = v; si = i; } });
  return { best: bi, bestVal: b, second: si, secondVal: s };
};

export class Behavior {
  constructor(meta, audio, { onEvent } = {}) {
    this.audio = audio;
    this.onEvent = onEvent;              // (type, detail) -> audience / mind / fx
    const ro = meta.readouts.find((r) => r.key === 'articulators');
    this.nerves = ro.neuronNerves;
    this.types = ro.neuronTypes;
    // synergy map: PhN neurons -> vowels, MxLbN neurons -> consonants (deterministic spread)
    this.phoneOf = this.nerves.map((nv, k) => {
      if (this.types[k] === 'CB0701') return null;            // MN9 = feeding, not voice
      const pool = nv === 'PhN' ? VOWELS : CONSONANTS;
      const nth = this.nerves.slice(0, k).filter((x) => x === nv).length;
      return pool[(nth * 7) % pool.length];
    });
    this.act = new Float32Array(ro.indices.length);          // EMA spikes/s per articulator
    this.rates = {};
    this.voiceEMA = 0; this.syllableTimer = 0; this.lastSyl = '';
    // phrases: start when voicing > ON, continue while > OFF (max PHRASE_MAX s), then a pause
    this.inPhrase = false; this.phraseT = 0; this.pause = 2;
    this.nausea = 0; this.retchCool = 0; this.fartCool = 0; this.vomitCool = 0;
    this.transcript = [];
    this.lesson = null;                  // { text, phones:[...], pos }
    this.enabled = { voice: true, body: true };
  }

  setLesson(text, phones) { this.lesson = text ? { text, phones, pos: 0, hits: 0 } : null; }

  /** feed each worker tick */
  tick(t) {
    if (!(t.winMs > 0.5)) return;                      // skip degenerate report windows (they blow rates up to Infinity/NaN)
    const s = t.winMs / 1000;
    const a = 1 - Math.exp(-t.winMs / 200);
    if (t.readout) t.readout.forEach((c, k) => { this.act[k] += (c / s - this.act[k]) * a; });
    for (const k of ['vocal', 'pharynx', 'fart', 'feed']) this.rates[k] = (this.rates[k] ?? 0) + ((t.rates['m:' + k] ?? 0) - (this.rates[k] ?? 0)) * a;
  }

  voicing() {
    let total = 0;
    this.act.forEach((v, k) => { if (this.phoneOf[k]) total += v; });
    // DN song drive dominates; articulator activity alone gives quieter speech/mutters
    return Math.min(1, this.rates.vocal / 25 + Math.max(0, total - 60) / 500);
  }

  update(dt, lenoState) {
    if (!this.audio.ctx) return;
    const pan = lenoState?.pan ?? 0;
    // ------------------------------------------------ voice
    const v = this.voicing();
    this.voiceEMA += (v - this.voiceEMA) * Math.min(1, dt * 4);
    if (!Number.isFinite(this.voiceEMA)) {           // recover from a bad window instead of staying NaN forever
      this.voiceEMA = 0; this.act.fill(0); for (const k in this.rates) this.rates[k] = 0;
    }
    this.syllableTimer -= dt; this.pause -= dt;
    if (!this.inPhrase && this.pause <= 0 && this.voiceEMA > 0.3) { this.inPhrase = true; this.phraseT = 0; }
    if (this.inPhrase) {
      this.phraseT += dt;
      if (this.voiceEMA < 0.18 || this.phraseT > 1.2 + 2.5 * this.voiceEMA) {
        this.inPhrase = false; this.pause = 3 + 6 * Math.random() * (1.2 - this.voiceEMA);
      }
    }
    if (this.enabled.voice && this.inPhrase && this.syllableTimer <= 0) {
      const vow = VOWELS.map((ph) => this.phoneScore(ph));
      const con = CONSONANTS.map((ph) => this.phoneScore(ph));
      const V = pickMax(vow), C = pickMax(con);
      let text, phones, gap;
      if (V.bestVal < 1 && C.bestVal < 1) {
        // drive without a clear articulation -> mutter
        const kind = this.voiceEMA > 0.3 ? 'uh' : 'hmm';
        this.audio.mutter(kind, { pan, gain: 0.5 + this.voiceEMA });
        text = kind; phones = []; gap = 0.45;
      } else {
        const vowel = V.bestVal >= 1 ? VOWELS[V.best] : 'AH';
        const cons = C.bestVal >= 1 ? CONSONANTS[C.best] : null;
        // stammer when two articulations compete (ambiguous command) or on an immediate repeat
        const ambiguous = V.secondVal > 0.92 * V.bestVal || (cons && C.secondVal > 0.92 * C.bestVal);
        const reps = ambiguous && Math.random() < 0.6 ? 1 + ((Math.random() * 2.2) | 0) : 0;
        phones = cons ? [cons, vowel] : [vowel];
        text = (cons ? cons.toLowerCase() + '-' : '').repeat(reps) + phones.join('').toLowerCase();
        this.speak(phones, reps, pan);
        gap = 0.16 + 0.12 * (1 - this.voiceEMA) + reps * 0.1;
      }
      this.syllableTimer = gap;
      this.transcript.push(text); if (this.transcript.length > 24) this.transcript.shift();
      this.said = (this.said || 0) + 1;                // running count (the show quotes what he said in a window)
      this.onEvent?.('speak', { text, phones, loud: this.voiceEMA, lesson: this.checkLesson(phones) });
    }
    // ------------------------------------------------ body
    if (!this.enabled.body) return;
    this.retchCool -= dt; this.fartCool -= dt; this.vomitCool -= dt;
    this.nausea = Math.max(0, this.nausea - dt * 0.15);
    const retchDrive = this.rates.pharynx > 12 && this.rates.feed < 20;
    if (retchDrive && this.retchCool <= 0) {
      this.nausea += 0.4;
      if (this.nausea > 1 && this.vomitCool <= 0) {
        this.audio.sfx('vomit', { pan }); this.onEvent?.('vomit', {});
        this.nausea = 0; this.vomitCool = 6; this.retchCool = 3;
      } else {
        this.audio.sfx('retch', { pan }); this.onEvent?.('retch', {});
        this.retchCool = 1.4;
      }
    }
    if (this.rates.fart > 15 && this.fartCool <= 0) {
      this.audio.sfx('fart', { pan }); this.onEvent?.('fart', {});
      this.fartCool = 2.5;
    }
  }

  phoneScore(ph) {
    let s = 0;
    this.phoneOf.forEach((p, k) => { if (p === ph) s += this.act[k]; });
    return s;
  }

  speak(phones, stammerReps, pan) {
    const seq = [];
    for (let r = 0; r < stammerReps; r++) seq.push(phones[0]);
    seq.push(...phones);
    let t = 0;
    for (const ph of seq) {
      setTimeout(() => this.audio.phoneme(ph, { pan, gain: 0.6 + 0.6 * this.voiceEMA }), t * 1000);
      t += 0.1;
    }
  }

  /** Speech lesson: does this syllable continue the target word? */
  checkLesson(phones) {
    const L = this.lesson;
    if (!L || !phones.length) return null;
    const want = L.phones.slice(L.pos, L.pos + phones.length);
    const vowelOk = (a, b) => a === b || (VOWELS.includes(a) && VOWELS.includes(b) && a[0] === b[0]);
    let match = 0;
    phones.forEach((p, i) => { if (want[i] && vowelOk(p, want[i])) match++; });
    const score = match / phones.length;
    if (score >= 0.5) { L.pos += phones.length; L.hits++; if (L.pos >= L.phones.length) { L.pos = 0; return { score, complete: true }; } }
    return { score, complete: false };
  }
}
