// Fly instincts: shape the brain's motor output into fly-like behaviour and connect Leno to food.
//
// Neural (through the model):
//   * touching food stimulates the sugar gustatory neurons (all 129 sugar/water GRNs); the model's own
//     MN9 (proboscis motor neuron) response decides whether Leno lowers his face and eats
//   * "dust" on the antennae now and then stimulates Johnston's-organ neurons, which drive the model's
//     antennal-grooming descending neurons (aDN1) -> Leno rubs his hands / wipes his face like a fly
// Engineered (body level, labelled as such in the UI):
//   * saccadic turning: a turning command is expressed as quick body saccades between straight runs
//   * walking in bouts: short stops between runs
//   * food taxis: when hungry, a steering bias toward the nearest food (the model's olfactory pathway
//     ignites runaway activity under any odour input, so smell can't be used for navigation)
import * as THREE from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Instincts {
  constructor({ food, stimRate, pulse, reinforce, audio, onEvent }) {
    Object.assign(this, { food, stimRate, pulse, reinforce, audio, onEvent });
    this.hunger = 0.4;
    this.eating = false;
    this.feedEMA = 0;
    this.sacc = { accum: 0, t: 0, dir: 0 };
    this.bout = { walking: true, t: 1.5 };
    this.dustT = 6;
    this.enabled = { saccades: true, bouts: true, taxis: true, dust: true };
    this.status = '';
    this.biteT = 0;
  }

  /** @returns adjusted motor command + postures */
  update(dt, host, cmd, rates) {
    const out = { ...cmd };
    const posture = { eat: 0, rub: 0 };
    this.hunger = clamp(this.hunger + dt / 90, 0, 1);
    this.feedEMA += ((rates?.['m:feed'] ?? 0) - this.feedEMA) * Math.min(1, dt * 4);
    const pos = host.position ?? host.root.position;
    const fwd = host.forward();

    // ---- food: taxis, taste on contact, eating
    // humanoid Leno ignores goose droppings; Fly-Leno is keen on them
    const near = this.food.nearest(pos, 18, host.isFly ? null : (it) => it.kind !== 'poop');
    const eager = host.isFly && near?.item.kind === 'poop';
    let inReach = false;
    this.status = '';
    if (near) {
      const mouth = host.mouth();
      const reach = Math.min(near.dist, Math.hypot(near.item.pos.x - mouth.x, near.item.pos.z - mouth.z));
      inReach = reach < (this.eating ? 2.0 : 1.15);          // once eating, stay with it
      const to = near.item.pos.clone().sub(pos).setY(0);
      let ang = Math.atan2(fwd.x * to.z - fwd.z * to.x, fwd.x * to.x + fwd.z * to.z);   // + = food to the left? (y-up)
      ang = -ang;
      this.taxis = false;
      if (this.enabled.taxis && this.hunger > (eager ? 0.05 : 0.25) && !inReach && !this.eating) {
        // like a fly homing on food: pivot until facing it, then walk straight in (slowly at the end)
        this.taxis = true;
        if (Math.abs(ang) > 0.35) { out.turn = Math.sign(ang); out.forward = 0; }
        else { out.turn = clamp(ang * 2, -0.5, 0.5); out.forward = Math.max(out.forward ?? 0, near.dist > 2 ? 0.7 : 0.35); }
        this.status = eager ? 'smells goose droppings - buzzing over' : `hungry (${(this.hunger * 100) | 0}%): heading for the ${near.item.kind}`;
      }
      // taste: legs/mouth on the food -> sugar receptor neurons
      this.stimRate('sugarTaste', inReach ? 45 * near.item.sweet : 0);
      if (inReach && this.feedEMA > (this.eating ? 5 : 12)) {
        this.quietT = 0;
        if (!this.eating) this.onEvent?.('eatStart', near.item);
        this.eating = true;
        posture.eat = 1;
        out.forward = reach > 1.1 ? 0.22 : 0; out.backward = 0;       // shuffle closer if the crouch drifted back
        out.turn = clamp(ang * 1.5, -0.6, 0.6);                    // keep facing the food
        this.biteT -= dt;
        if (this.biteT <= 0) { this.biteT = 0.6 + Math.random() * 0.5; this.onEvent?.('bite', near.item); }
        const done = this.food.eat(near.item, dt * 0.09 * (0.5 + this.feedEMA / 60));
        this.status = `eating the ${near.item.kind} (MN9 ${this.feedEMA.toFixed(0)} Hz)`;
        if (done) this.finishMeal(near.item);
      } else if (this.eating) {
        // MN9 must stay quiet for a moment before he gives up on the meal
        this.quietT = (this.quietT || 0) + dt;
        if (!inReach || this.quietT > 0.8) this.eating = false; else posture.eat = 1;
      } else if (inReach) this.status = `tasting the ${near.item.kind}… (MN9 ${this.feedEMA.toFixed(0)} Hz)`;
    } else {
      this.stimRate('sugarTaste', 0);
      this.eating = false;
    }

    // ---- grooming: occasional dust on the antennae (neural route: JO -> aDN1)
    this.dustT -= dt;
    if (this.enabled.dust && this.dustT <= 0) {
      this.dustT = 9 + Math.random() * 14;
      this.pulse('dust', 'applause', 160, 0.6);
    }
    const g = cmd.groom ?? 0;
    if (g > 0.08 && g < 0.5) { posture.rub = 1; out.groom = 0; }       // mild: rub the hands together
    // strong grooming keeps the VNC face-wipe pattern

    // ---- walking bouts (stop-and-go)
    if (this.enabled.bouts && (out.forward ?? 0) > 0.15 && !this.eating && !this.taxis) {
      this.bout.t -= dt;
      if (this.bout.t <= 0) {
        this.bout.walking = !this.bout.walking;
        this.bout.t = this.bout.walking ? 1.2 + Math.random() * 2.2 : 0.25 + Math.random() * 0.5;
      }
      if (!this.bout.walking) out.forward = 0;
    }

    // ---- saccades: integrate the turning command, release it as quick turns
    if (this.enabled.saccades && !this.eating && !this.taxis) {
      const s = this.sacc;
      if (s.t > 0) { s.t -= dt; out.turn = s.dir; }
      else {
        s.accum = clamp(s.accum + (out.turn ?? 0) * dt, -1, 1);
        out.turn = 0;
        if (Math.abs(s.accum) > 0.22) { s.dir = Math.sign(s.accum); s.t = 0.18 + Math.abs(s.accum) * 0.35; s.accum = 0; }
        s.accum *= 1 - dt * 0.3;
      }
    }
    return { cmd: out, posture };
  }

  finishMeal(item) {
    this.eating = false;
    this.hunger = 0;
    this.stimRate('sugarTaste', 0);
    this.reinforce(0.6, 1.5);                      // a sugar meal is rewarding (PAM)
    this.onEvent?.('ate', item);
    setTimeout(() => this.pulse('dust', 'applause', 160, 0.8), 1200);   // clean up after eating
  }
}
