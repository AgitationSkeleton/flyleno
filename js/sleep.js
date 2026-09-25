// Sleep (engineered, like the other instincts in js/instincts.js; not a model of the fly's own sleep circuits).
//
// Sleep pressure builds while he's awake (faster when he's tired, and during the late late show's lullaby) and
// drains while he sleeps. When it's high and he's safe (nothing looming, not frightened, held, eating, falling
// or being knocked about) he settles down and dozes off. Asleep, his eyes are shut (no light drive to the
// photoreceptors) and hearing and touch are turned down (sensory gating), his body rests: energy comes back fast
// and injuries heal faster. A hit, a touch, a loud noise or something looming wakes him, easily in light sleep and
// less easily once he's deep asleep. Otherwise he wakes up by himself when he's rested. Asleep he doesn't talk or
// retch (js/behavior.js); the show goes on around him.
export class Sleep {
  constructor() {
    this.enabled = true;
    this.pressure = 0.15;       // 0 rested .. 1 can't keep his eyes open
    this.asleep = false;
    this.depth = 0;             // 0 light .. 1 deep
    this.settleT = 0;
    this.disturb = 0;           // recent jolts (touch, noise), decaying
    this.lullaby = false;
    this.sleptFor = 0;
    this.onSleep = null; this.onWake = null;
  }

  get drowsy() { return !this.asleep && this.pressure > 0.6; }

  /** something jolted him (a touch, a hit, a noise): 0..1+ */
  jolt(x) { if (this.asleep) this.disturb += x; }

  /** s: { energy 0..1, fear 0..1, loom (LC4 rate, Hz), held, eating, knocked, fallen, flying } */
  update(dt, s) {
    if (!dt) return;
    if (!this.enabled) { if (this.asleep) this.wake('switched off'); this.pressure = 0; this.settleT = 0; return; }
    if (this.asleep) {
      this.sleptFor += dt;
      this.pressure = Math.max(0, this.pressure - dt / 45);          // ~45 s from exhausted to rested
      this.depth = Math.min(1, this.depth + dt / 8);
      const threshold = 0.3 + 0.9 * this.depth;
      if (s.held || s.knocked) this.wake('startled');
      else if (this.disturb > threshold) this.wake(this.disturbWhy || 'startled');
      else if (s.loom > 70 * (1 + this.depth)) this.wake('something looming');
      else if (this.pressure <= 0.02 && this.sleptFor > 20) this.wake('rested');
    } else {
      const tired = 1 - (s.energy ?? 1);
      this.pressure = Math.min(1, this.pressure + dt * (1 / 360 + tired / 220 + (this.lullaby ? 1 / 55 : 0)));
      const safe = (s.fear ?? 0) < 0.2 && (s.loom ?? 0) < 25 && !s.held && !s.eating && !s.knocked && !s.fallen && !s.flying;
      this.settleT = this.pressure > (this.lullaby ? 0.5 : 0.75) && safe ? this.settleT + dt : 0;
      if (this.settleT > 4) this.fallAsleep();
    }
    this.disturb = Math.max(0, this.disturb - dt * 0.5);
  }

  fallAsleep() { this.asleep = true; this.depth = 0; this.sleptFor = 0; this.disturb = 0; this.onSleep?.(); }
  wake(why = 'rested') { if (!this.asleep) return; this.asleep = false; this.depth = 0; this.settleT = 0; this.disturb = 0; this.onWake?.(why); }
}
