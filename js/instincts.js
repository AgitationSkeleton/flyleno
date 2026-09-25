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
// Engineered input onto real neurons:
//   * homing: the starting mark on the stage is home, but he's free to wander. Near home (most of the stage top)
//     there's no pull at all. Farther out, homesickness builds slowly (minutes; faster the farther away, fastest
//     off the stage); when it's full he sets off on a trip home, and now and then he heads back on a whim. On a
//     trip, a home vector (path integration, which real flies do in the central complex, not modelled here)
//     drives the brain's own steering (DNa01/02 left or right) and walking (P9) descending neurons, so the fly
//     brain itself turns and walks him back; the trip ends when he's near his mark. Food and eating come first.
import * as THREE from 'three';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class Instincts {
  constructor({ food, stimRate, stimAlias, pulse, reinforce, audio, onEvent, home = null }) {
    Object.assign(this, { food, stimRate, stimAlias, pulse, reinforce, audio, onEvent, home });
    this.homesick = 0; this.homeUrge = 0; this.trip = false;
    this.asleep = false;               // set by js/sleep.js: no seeking food, no homing, no walking
    this.hunger = 0.4;
    this.eating = false;
    this.feedEMA = 0;
    this.sacc = { accum: 0, t: 0, dir: 0 };
    this.bout = { walking: true, t: 1.5 };
    this.dustT = 6;
    this.enabled = { saccades: true, bouts: true, taxis: true, dust: true, homing: true };
    this.status = '';
    this.biteT = 0;
  }

  /** @returns adjusted motor command + postures */
  update(dt, host, cmd, rates) {
    this.host = host;
    const out = { ...cmd };
    const posture = { eat: 0, rub: 0 };
    this.hunger = clamp(this.hunger + dt / (this.asleep ? 240 : 90), 0, 1);      // slower while he sleeps
    if (this.asleep) {
      // asleep: still (the body settles into its sleeping posture); no taste, no homing drive
      this.eating = false; this.taxis = false; this.status = 'asleep';
      this.stimRate('sugarTaste', 0);
      this.homing(dt, host.position ?? host.root.position, host.forward(), true, out);
      return { cmd: { ...out, forward: 0, backward: 0, turn: 0, groom: 0 }, posture };
    }
    this.feedEMA += ((rates?.['m:feed'] ?? 0) - this.feedEMA) * Math.min(1, dt * 4);
    const pos = host.position ?? host.root.position;
    const fwd = host.forward();

    // ---- food: taxis, taste on contact, eating
    // goose droppings are food for both forms: humanoid Leno eats them when he's hungry, Fly-Leno is keen on them.
    // Something he's keen on (droppings for the fly, the mushroom, a cake) wins over a nearer plain snack; in flight
    // the fly still sees food on the floor below
    const edible = null;
    const keen = (it) => (host.isFly && it.kind === 'poop') || !!it.eager;
    const dy = host.isFly && host.flying ? 8 : 1.5;
    const near = this.food.nearest(pos, 18, (it) => (!edible || edible(it)) && keen(it), dy) ?? this.food.nearest(pos, 18, edible, dy);
    const eager = !!near && keen(near.item);
    let inReach = false;
    this.status = '';
    if (near) {
      const mouth = host.mouth();
      const reach = Math.min(near.dist, Math.hypot(near.item.pos.x - mouth.x, near.item.pos.z - mouth.z));
      inReach = reach < (this.eating ? 2.0 : 1.15);          // once eating, stay with it
      if (host.isFly && host.flying) inReach = inReach && Math.abs(near.item.pos.y - mouth.y) < 0.8;   // (not from the air)
      const to = near.item.pos.clone().sub(pos).setY(0);
      this.foodDir = to.clone().normalize();
      let ang = Math.atan2(fwd.x * to.z - fwd.z * to.x, fwd.x * to.x + fwd.z * to.z);   // + = food to the left? (y-up)
      ang = -ang;
      this.taxis = false;
      if (this.enabled.taxis && this.hunger > (eager ? 0.05 : 0.25) && !inReach && !this.eating) {
        // like a fly homing on food: pivot until facing it, then walk straight in (slowly at the end)
        this.taxis = true;
        if (Math.abs(ang) > 0.35) { out.turn = Math.sign(ang); out.forward = 0; }
        else { out.turn = clamp(ang * 2, -0.5, 0.5); out.forward = Math.max(out.forward ?? 0, near.dist > 2 ? 0.7 : 0.35); }
        this.status = eager ? (near.item.kind === 'mushroom' ? 'spots the mushroom - going for it' : near.item.kind === 'cake' ? 'birthday cake! going for it'
          : 'smells goose droppings - buzzing over') : `hungry (${(this.hunger * 100) | 0}%): heading for the ${near.item.kind}`;
      }
      // taste: legs/mouth on the food -> sugar receptor neurons
      this.stimRate('sugarTaste', inReach ? 45 * near.item.sweet : 0);
      if (inReach && this.feedEMA > (this.eating ? 5 : 12)) {
        this.quietT = 0;
        if (!this.eating) this.onEvent?.('eatStart', near.item);
        this.eating = true;
        posture.eat = 1;
        // down at the food: steer by where it is relative to his mouth (his body can end up right over it, where
        // the angle from the body swings about), and only when it's clearly off to one side or out ahead
        const toM = near.item.pos.clone().sub(mouth).setY(0);
        const side = -(fwd.x * toM.z - fwd.z * toM.x), ahead = fwd.x * toM.x + fwd.z * toM.z;   // side > 0: turn + (as ang above)
        out.forward = ahead > 0.6 ? 0.2 : 0; out.backward = 0;        // shuffle closer if the crouch drifted back
        out.turn = Math.abs(side) > 0.35 ? clamp(side, -0.3, 0.3) : 0;
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
      this.eating = false; this.taxis = false;
    }

    // ---- homing: steer the brain's own DNs back toward the starting mark
    this.homing(dt, pos, fwd, near && (this.taxis || inReach || this.eating), out);
    if (near && this.taxis) host.guide?.(this.foodDir, eager ? 0.8 : 0.6);   // led to the food he's heading for

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

  homing(dt, pos, fwd, busy, out) {
    if (!this.home || !this.stimAlias) return;
    const to = this.home.clone().sub(pos).setY(0), d = to.length();
    const FREE = 4.5;                                   // m: roaming range with no pull at all
    const off = this.enabled.homing === false;
    // homesickness: builds slowly beyond the free range (faster the farther out: ~4 min just outside it, under
    // 2 min off the stage), fades while he's near home
    if (off) { this.homesick = 0; this.trip = false; }
    else if (d > FREE) this.homesick = Math.min(1, this.homesick + dt * (0.004 + 0.007 * clamp((d - FREE) / 6, 0, 1)));
    else this.homesick = Math.max(0, this.homesick - dt * 0.01);
    // a trip home: when homesickness is full, or now and then on a whim (about every 5 minutes on average)
    if (!off && !this.trip && (this.homesick >= 1 || (d > 2.5 && Math.random() < dt / 300))) this.trip = true;
    if (this.trip && d < 1.8) { this.trip = false; this.homesick = 0; }
    const want = busy || off || !this.trip ? 0 : 0.65;
    this.homeUrge += (want - this.homeUrge) * Math.min(1, dt * 1.5);
    const u = this.homeUrge;
    // signed angle to home (> 0: home is to his left)
    const ang = -Math.atan2(fwd.x * to.z - fwd.z * to.x, fwd.x * to.x + fwd.z * to.z);
    const turn = 32 * u * clamp(Math.abs(ang) / 0.8, 0, 1);
    this.stimAlias('homeTurnL', 'turnL', ang > 0.1 ? turn : 0);
    this.stimAlias('homeTurnR', 'turnR', ang < -0.1 ? turn : 0);
    this.stimAlias('homeWalk', 'walk', 28 * u * (Math.abs(ang) < 0.6 ? 1 : 0.25));
    // body level (like food taxis): with home well off to one side, turn toward it rather than walk on
    // (the ragdoll turns slowly, so the brain's turn alone loses to its own forward walking)
    if (u > 0.15 && Math.abs(ang) > 0.6) {
      out.forward = (out.forward ?? 0) * (1 - 0.85 * u);
      out.turn = clamp((out.turn ?? 0) + Math.sign(ang) * u, -1, 1);
    }
    // the ragdoll's own walking is weak and drifts, so the puppeteer also leads him home gently by his strings
    this.host?.guide?.(u > 0.05 ? to.normalize() : null, u * 0.85);
    if (u > 0.1 && d > 2 && !this.status) this.status = `heading home (${d.toFixed(1)} m)`;
    else if (this.homesick > 0.5 && !this.status) this.status = `homesick (${d.toFixed(1)} m from his mark)`;
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
