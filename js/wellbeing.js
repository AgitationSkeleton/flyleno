// Leno's state of mind and body, for the Mind panel. Read-outs, not drives: they summarise what the brain and the
// body are going through (the brain's own dopamine, arousal and looming neurons; hits, rain, meals, falls, sleep...).
//
// Everything that happens to him already reaches the brain as a named sensory pulse (js/main.js pulse()), so the
// body state listens to those: a pipe hit is 'hitTouch', a zap 'zapTouch', rain 'rainTouch', a fall 'fallTouch'...
//
// Every bad state has a way back, and the panel says which: injuries heal (faster asleep), dizziness wears off,
// rain dries (and rinses off grime), grooming cleans, food and rest restore energy and sleep restores it fast,
// stress and fear fade when he's safe (faster asleep, or with praise), hunger ends with a meal, homesickness with
// a trip home, sleepiness with sleep.
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// what a sensory pulse does to the body: injury, dizziness, wetness, grime (each 0..1 per pulse, scaled by rate)
const EFFECTS = {
  hitTouch: { injury: 0.06, dizzy: 0.15 },        // tomato or pipe (scaled by the pulse rate: a pipe is harder)
  hitTaste: { grime: 0.12 },                     // tomato juice
  rigTouch: { injury: 0.22, dizzy: 0.45 },
  swatHit: { injury: 0.08, dizzy: 0.3 },
  zapTouch: { injury: 0.12, dizzy: 0.5 },
  spiderGrab: { injury: 0.04 },
  spiderBump: { injury: 0.03, dizzy: 0.1 },
  alienKick: { injury: 0.006, dizzy: 0.05 },      // lots of little kicks
  frogHit: { injury: 0.03, grime: 0.06 },        // sticky tongue
  fallTouch: { injury: 0.05, dizzy: 0.2 },
  contactTouch: { injury: 0.001 },
  rainTouch: { wet: 0.06 },
  confettiTouch: { grime: 0.01 },
  roseTouch: {},
  sugarTouch: {},
  itch: { grime: 0.03 },
};

export class Wellbeing {
  constructor() {
    this.injury = 0; this.dizzy = 0; this.wet = 0; this.grime = 0; this.energy = 1;
    this.stress = 0; this.fear = 0; this.cheer = 0.5;
    this.runaways = [];                             // times (s) of recent runaway resets
    this.t = 0;
  }

  /** a sensory pulse fired (see EFFECTS) */
  sensed(alias, rate = 60) {
    const e = EFFECTS[alias]; if (!e) return;
    const k = alias === 'hitTouch' ? Math.min(1.5, rate / 60) : 1;
    if (e.injury) this.injury = clamp01(this.injury + e.injury * k);
    if (e.dizzy) this.dizzy = clamp01(this.dizzy + e.dizzy * k);
    if (e.wet) this.wet = clamp01(this.wet + e.wet);
    if (e.grime) this.grime = clamp01(this.grime + e.grime);
    if (e.injury) this.stress = clamp01(this.stress + e.injury * 2);
  }

  /** reward (+) or punishment (-) delivered to the dopamine neurons: punishment stresses him, praise calms him */
  reinforced(valence) {
    if (valence < 0) this.stress = clamp01(this.stress - valence * 0.12);
    else this.stress = clamp01(this.stress - valence * 0.06);
    this.cheer = clamp01(this.cheer + valence * 0.05);
  }

  ate(kind) {
    const boost = { sugar: 0.3, mushroom: 0.6, cake: 0.5, 'éclair': 0.2, tomato: 0.12, poop: 0.15 }[kind] ?? 0.1;
    this.energy = clamp01(this.energy + boost);
    if (kind === 'poop' || kind === 'tomato') this.grime = clamp01(this.grime + 0.05);
  }

  vomited() { this.energy = clamp01(this.energy - 0.1); this.grime = clamp01(this.grime + 0.1); }
  runaway() { this.runaways.push(this.t); }

  /**
   * s: { dt, arousal, mood, cmd (motor command), rates (tick rates), host, isFly, flying, fallen, held, eating,
   *      knocked, glitch, hunger, nausea, homesick, spikes, eatenFrac, asleep, depth, sleepiness }
   */
  update(s) {
    const dt = s.dt; if (!dt) return;
    this.t += dt;
    const c = s.cmd || {};
    const deep = s.asleep ? (s.depth ?? 0.5) : 0;
    // body: injuries heal slowly (faster at rest, fastest asleep), dizziness wears off, rain dries (and rinses),
    // grooming cleans
    const activity = s.asleep ? 0 : Math.max(c.forward ?? 0, c.backward ?? 0, Math.abs(c.turn ?? 0) * 0.5, s.flying ? 0.8 : 0, c.startle ?? 0);
    const resting = activity < 0.1 && !s.fallen;
    this.injury = Math.max(0, this.injury - dt * (s.asleep ? 0.004 + 0.01 * deep : resting ? 0.004 : 0.0015));
    this.dizzy = Math.max(0, this.dizzy - dt * (s.asleep ? 0.3 : 0.12));
    if (s.knocked) this.dizzy = clamp01(this.dizzy + dt * 0.8);
    if (s.glitch) this.dizzy = clamp01(this.dizzy + dt * 0.25);
    this.wet = Math.max(0, this.wet - dt * 0.015);
    if (this.wet > 0.2) this.grime = Math.max(0, this.grime - dt * 0.01 * this.wet);
    if ((c.groom ?? 0) > 0.3) this.grime = Math.max(0, this.grime - dt * 0.06);
    // energy: spent by moving, flying and struggling; a slow baseline burn; back while resting, fast while asleep
    const gain = s.asleep ? 0.006 + 0.018 * deep : resting ? 0.002 : 0;
    this.energy = clamp01(this.energy - dt * (s.asleep ? 0 : 0.0008 + 0.004 * activity + (s.held ? 0.01 : 0)) + dt * gain);
    // mind: fear follows the looming detectors and startles; stress builds with threats and fades over ~30 s when
    // he's safe (much faster asleep)
    const lc4 = (s.rates?.['s:heckler'] ?? 0) / 200;
    const fearNow = s.asleep ? 0 : clamp01(Math.max(lc4 * 1.4, (c.startle ?? 0) * 0.8));
    this.fear += (fearNow - this.fear) * Math.min(1, dt * (fearNow > this.fear ? 6 : 0.6));
    this.stress = clamp01(this.stress + dt * (0.05 * this.fear + 0.02 * (s.held ? 1 : 0)) - dt * this.stress * (s.asleep ? 0.12 : this.fear < 0.1 ? 0.04 : 0.02));
    this.cheer += ((s.mood + 1) / 2 - this.cheer) * Math.min(1, dt * 0.2);
    this.runaways = this.runaways.filter((x) => this.t - x < 300);
    this.s = s;
  }

  /** rows for the panel: [label, sub, value 0..1, text, good (true = high is good)] */
  rows() {
    const s = this.s || {};
    const brainLoad = clamp01((s.spikes ?? 0) / 150000);
    return {
      mind: [
        ['Arousal', '', s.arousal ?? 0, pct(s.arousal), null],
        ['Stress', '', this.stress, pct(this.stress), false],
        ['Fear', '', this.fear, pct(this.fear), false],
        ['Morale', '', this.cheer, pct(this.cheer), true],
        ['Hunger', '', s.hunger ?? 0, pct(s.hunger), false],
        ['Nausea', '', clamp01(s.nausea ?? 0), pct(s.nausea), false],
        ['Homesick', '', s.homesick ?? 0, pct(s.homesick), false],
        ['Sleepiness', '', s.sleepiness ?? 0, s.asleep ? 'zzz' : pct(s.sleepiness), false],
        ['Dizziness', '', this.dizzy, pct(this.dizzy), false],
      ],
      body: [
        ['Health', '', 1 - this.injury, pct(1 - this.injury), true],
        ['Energy', '', this.energy, pct(this.energy), true],
        ['Wetness', '', this.wet, pct(this.wet), false],
        ['Grime', '', this.grime, pct(this.grime), false],
      ],
      brain: [
        ['Brain load', '', brainLoad, `${((s.spikes ?? 0) / 1000).toFixed(0)}k`, false],
        ['Brain worms', '', clamp01((s.eatenFrac ?? 0) / 0.35), `${((s.eatenFrac ?? 0) * 100).toFixed(1)}%`, false],
      ],
    };
  }

  /** where he is and how he is, in a few words */
  summary() {
    const s = this.s || {};
    const posture = s.asleep ? (s.depth > 0.6 ? 'fast asleep' : 'asleep') : s.held ? 'held in a grip' : s.knocked ? 'tumbling' : s.fallen ? 'down on the floor' : s.eating ? 'eating'
      : s.flying ? 'flying' : 'on his feet';
    const bits = [];
    if (this.injury > 0.5) bits.push('badly hurt'); else if (this.injury > 0.2) bits.push('bruised');
    if (this.energy < 0.25) bits.push('exhausted'); else if (this.energy < 0.5) bits.push('tired');
    if (!s.asleep && (s.sleepiness ?? 0) > 0.6) bits.push('drowsy');
    if (this.dizzy > 0.4) bits.push('dizzy');
    if (this.wet > 0.4) bits.push('soaked'); else if (this.wet > 0.1) bits.push('damp');
    if (this.grime > 0.4) bits.push('filthy'); else if (this.grime > 0.15) bits.push('grubby');
    if ((s.nausea ?? 0) > 0.6) bits.push('queasy');
    if (this.fear > 0.5) bits.push('frightened'); else if (this.stress > 0.5) bits.push('stressed');
    if ((s.hunger ?? 0) > 0.7) bits.push('starving');
    if (this.runaways.length) bits.push(`${this.runaways.length} brain reset${this.runaways.length > 1 ? 's' : ''} in 5 min`);
    const how = bits.length ? bits.slice(0, 4).join(', ') : this.cheer > 0.6 ? 'in fine form' : 'fine';
    return `${posture}; ${how}`;
  }
}

const pct = (x) => `${Math.round(clamp01(x ?? 0) * 100)}%`;
