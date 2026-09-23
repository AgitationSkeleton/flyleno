// The studio audience: reacts to what Leno does, with mixed, somewhat random reactions.
// A reaction is (1) heard by the fly through the in-world audio (hearing.js -> JO neurons) and
// (2) delivered as reinforcement to its dopaminergic neurons:
//     cheer / laugh / applause -> PAM (reward)      boo / gasp -> PPL1 (punishment)
// The crowd has its own slowly drifting temperament and gets bored of repeated acts (novelty),
// so the fly has to vary what it does to keep the audience happy.
const TABLE = {
  //            cheer laugh applause boo  gasp  (relative weights)
  vomit:      [0.05, 0.25, 0.05, 0.35, 0.60],
  retch:      [0.02, 0.30, 0.00, 0.30, 0.40],
  fart:       [0.10, 0.70, 0.10, 0.30, 0.10],
  speak:      [0.25, 0.15, 0.20, 0.15, 0.00],
  word:       [0.70, 0.10, 0.70, 0.02, 0.05],
  startle:    [0.05, 0.60, 0.05, 0.05, 0.40],
  groom:      [0.05, 0.40, 0.05, 0.20, 0.00],
  stroll:     [0.20, 0.05, 0.20, 0.10, 0.00],
  fall:       [0.10, 0.60, 0.05, 0.15, 0.60],
  tomatoHit:  [0.25, 0.90, 0.30, 0.05, 0.15],
  pipeHit:    [0.15, 0.60, 0.10, 0.10, 0.90],
  eat:        [0.35, 0.50, 0.40, 0.10, 0.10],
  lay:        [0.20, 0.40, 0.15, 0.15, 0.80],
  goose:      [0.30, 0.90, 0.20, 0.05, 0.30],
  eatPoop:    [0.10, 0.60, 0.05, 0.60, 0.90],
  hatch:      [0.80, 0.50, 0.70, 0.05, 0.30],
  burp:       [0.20, 0.80, 0.15, 0.20, 0.10],
  frogTongue: [0.10, 0.70, 0.05, 0.10, 0.80],
  frogSpit:   [0.40, 0.90, 0.30, 0.05, 0.40],
  frogBite:   [0.60, 0.80, 0.40, 0.30, 0.50],
  frogKicked: [0.80, 0.40, 0.70, 0.30, 0.10],
  backflip:   [1.00, 0.30, 0.90, 0.02, 0.40],
  backflipFail: [0.02, 0.40, 0.02, 0.90, 0.10],
  spiderDrop: [0.50, 0.40, 0.50, 0.05, 0.60],
  swatHit:    [0.20, 0.90, 0.10, 0.10, 0.60],
  zap:        [0.20, 0.60, 0.10, 0.10, 0.90],
  alienKick:  [0.30, 0.90, 0.20, 0.10, 0.30],
  rigHit:     [0.05, 0.30, 0.02, 0.20, 1.00],
  powerUp:    [1.00, 0.30, 0.90, 0.02, 0.20],
  roseHit:    [1.00, 0.20, 1.00, 0.02, 0.20],
};
const KINDS = ['cheer', 'laugh', 'applause', 'boo', 'gasp'];
const VALENCE = { cheer: 1, laugh: 0.7, applause: 1, boo: -1, gasp: -0.5 };

export class Audience {
  constructor(audio, reinforce, { onReact } = {}) {
    this.audio = audio;
    this.reinforce = reinforce;          // (valence -1..1, seconds) -> stimulates PAM/PPL1
    this.onReact = onReact;
    this.temper = 0;                     // -1 hostile .. +1 generous, random walk
    this.bored = {};                     // act -> boredom 0..1
    this.cool = 0;
    this.chance = 0.55;                  // probability that an act gets any reaction
    this.log = [];
  }

  update(dt) {
    this.cool -= dt;
    this.temper = Math.max(-1, Math.min(1, this.temper * (1 - dt * 0.02) + (Math.random() - 0.5) * dt * 0.3));
    for (const k in this.bored) this.bored[k] = Math.max(0, this.bored[k] - dt * 0.05);
  }

  /** Something happened on stage. Returns the reaction (or null). */
  react(act, detail = {}) {
    if (this.away) return null;                    // nobody in the seats (the Rapture)
    let w = TABLE[act];
    if (!w || this.cool > 0) return null;
    if (act === 'speak' && detail.lesson?.complete) w = TABLE.word;
    const novelty = 1 - (this.bored[act] ?? 0);
    this.bored[act] = Math.min(1, (this.bored[act] ?? 0) + 0.25);
    const p = this.chance * (act === 'speak' ? 0.25 + (detail.lesson?.score ?? 0) * 0.6 : 1) * (0.4 + 0.6 * novelty);
    if (Math.random() > p) return null;
    // temperament and novelty tilt the weights: bored/hostile crowds boo more
    const weights = w.map((x, i) => {
      const val = VALENCE[KINDS[i]];
      return Math.max(0.001, x * (1 + 0.8 * this.temper * val) * (val > 0 ? novelty + 0.2 : 1.2 - novelty * 0.5));
    });
    let r = Math.random() * weights.reduce((a, b) => a + b, 0), kind = KINDS[0];
    for (let i = 0; i < KINDS.length; i++) { if ((r -= weights[i]) <= 0) { kind = KINDS[i]; break; } }
    const intensity = 0.5 + 0.5 * Math.random();
    const dur = this.audio.crowd(kind, { gain: 0.6 + 0.6 * intensity });
    Promise.resolve(dur).then((d) => this.reinforce(VALENCE[kind] * intensity, Math.max(0.6, Math.min(3, d || 1.5))));
    this.cool = 1.2;
    const entry = { act, kind, intensity, t: performance.now() };
    this.log.push(entry); if (this.log.length > 30) this.log.shift();
    this.onReact?.(entry);
    return entry;
  }
}
