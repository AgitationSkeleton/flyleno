// The fly's "state of mind" and action selection.
//
// Dopamine comes from the brain model itself: the worker reports DA = tanh((PAM − PPL1 rate)/20 Hz).
//   mood    = slow average of DA (−1 miserable .. +1 elated)
//   arousal = recent overall firing
// Two learning systems use it:
//   1. Inside the connectome (brain-worker.js): dopamine-gated plasticity on all synapses onto the
//      articulator motor neurons, so rewarded vocalisations become more likely.
//   2. Here, an action selector (a basal-ganglia-like layer that is NOT part of the connectome) that
//      decides what the fly spontaneously initiates by stimulating the corresponding descending/motor
//      neurons ("fictive" drives). Each action's value Q is learned from the dopamine that follows it;
//      choice is softmax(Q / T) with temperature T rising when mood is bad (restless, exploratory)
//      and falling when mood is good (keep doing what works).
export const ACTIONS = [
  { key: 'talk', stim: ['vocal'], dur: [1.5, 3.5], label: 'talk' },
  { key: 'stroll', stim: ['walk'], dur: [1.5, 4], label: 'stroll', extra: [['turnL', 'turnR']] },
  { key: 'turn', stim: [], dur: [0.6, 1.5], label: 'turn', extra: [['turnL', 'turnR']], forceExtra: true },
  { key: 'backup', stim: ['reverse'], dur: [0.6, 1.2], label: 'back up' },
  { key: 'fart', stim: ['fartDrive'], dur: [0.3, 0.6], label: 'fart' },
  { key: 'retch', stim: ['retchDrive'], dur: [0.4, 0.9], label: 'retch' },
  { key: 'rest', stim: [], dur: [1, 3], label: 'rest' },
];

export class Mind {
  constructor(setStim) {
    this.setStim = setStim;              // (key, on) => void
    this.mood = 0; this.da = 0; this.arousal = 0;
    this.Q = Object.fromEntries(ACTIONS.map((a) => [a.key, 0]));
    this.alpha = 0.25;
    this.initiative = true;
    this.current = null;                 // { action, keys, until, daSum, t0 }
    this.credit = [];                    // recent actions waiting for dopamine credit
    this.next = 3;
    this.t = 0;
    this.history = [];
  }

  tick(t) {
    const a = 1 - Math.exp(-t.winMs / 4000);
    this.da = t.dopamine ?? 0;
    this.mood += (this.da - this.mood) * a;
    this.arousal += (Math.min(1, t.spikesPerSec / 60000) - this.arousal) * (1 - Math.exp(-t.winMs / 1000));
    // credit assignment: dopamine within 4 s after an action counts toward its value
    for (const c of this.credit) c.daSum += this.da * (t.winMs / 1000);
  }

  temperature() { return 0.15 + 0.5 * (1 - (this.mood + 1) / 2); }

  update(dt) {
    this.t += dt;
    // settle credit
    this.credit = this.credit.filter((c) => {
      if (this.t - c.t0 < 4) return true;
      const r = c.daSum / 4;             // mean DA over the window
      this.Q[c.key] += this.alpha * (r - this.Q[c.key]);
      return false;
    });
    if (this.current && this.t >= this.current.until) {
      this.current.keys.forEach((k) => this.setStim(k, false));
      this.current = null;
    }
    if (!this.initiative || this.suspended || this.current || this.t < this.next) return;   // suspended: asleep
    // softmax choice
    const T = this.temperature();
    const ex = ACTIONS.map((a) => Math.exp(this.Q[a.key] / T));
    let r = Math.random() * ex.reduce((x, y) => x + y, 0), act = ACTIONS[0];
    for (let i = 0; i < ACTIONS.length; i++) { if ((r -= ex[i]) <= 0) { act = ACTIONS[i]; break; } }
    const dur = act.dur[0] + Math.random() * (act.dur[1] - act.dur[0]);
    const keys = [...act.stim];
    for (const opts of act.extra || []) if (act.forceExtra || Math.random() < 0.6) keys.push(opts[(Math.random() * opts.length) | 0]);
    keys.forEach((k) => this.setStim(k, true));
    this.current = { action: act.key, keys, until: this.t + dur };
    this.credit.push({ key: act.key, t0: this.t, daSum: 0 });
    this.history.push(act.key); if (this.history.length > 12) this.history.shift();
    // bored/aroused flies act more often
    this.next = this.t + dur + (1 + 3 * (1 - this.arousal)) * (0.5 + Math.random());
  }

  stopAll() {
    if (this.current) { this.current.keys.forEach((k) => this.setStim(k, false)); this.current = null; }
  }
}

// Rough English grapheme -> ARPAbet for speech lessons (good enough for short words).
export function toPhones(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  const out = [];
  const di = { sh: 'SH', ch: 'SH', th: 'T', ng: 'N', ph: 'F', ck: 'K', ee: 'IY', oo: 'UW', ea: 'IY', ou: 'AW', ow: 'OW', ai: 'EY', ay: 'EY', oy: 'OY', oi: 'OY', er: 'ER', ar: 'AA', or: 'AO' };
  const one = { a: 'AE', e: 'EH', i: 'IH', o: 'AA', u: 'AH', y: 'IY', b: 'B', c: 'K', d: 'D', f: 'F', g: 'G', h: 'HH', j: 'Y', k: 'K', l: 'L', m: 'M', n: 'N', p: 'P', q: 'K', r: 'R', s: 'S', t: 'T', v: 'V', w: 'W', x: 'K', z: 'Z' };
  for (let i = 0; i < w.length;) {
    const two = w.slice(i, i + 2);
    if (di[two]) { out.push(di[two]); i += 2; continue; }
    if (w[i] === 'e' && i === w.length - 1 && out.length) { i++; continue; }   // silent final e
    if (one[w[i]]) out.push(one[w[i]]);
    i++;
  }
  return out;
}
