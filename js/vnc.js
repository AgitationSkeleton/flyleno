// "Ventral nerve cord": a small central pattern generator that turns the fly's high-level motor
// command into coordinated muscle activations for Leno's ragdoll (js/ragdoll.js).
//
// In the fly, walking rhythms and leg coordination are generated in the VNC, which is not part of
// the brain connectome; the brain only sends descending commands (walk, turn, back up, startle,
// groom, feed). This module is the stand-in for that circuitry. It is open-loop: it works in joint
// angles (degrees, flex = positive, see MUSCLE_DOFS) and converts each DOF to an
// antagonistic pair  a_flex = tone + max(d, 0),  a_ext = tone + max(-d, 0),  d = angle / range.
//
//   const vnc = new VNC();
//   const act = vnc.update(dt, { forward, backward, turn, startle, groom, feed }, sense?);   // {muscle: 0..1}
//
// Optional `sense = { yawRate }` (rad/s, + = turning left, e.g. RagdollLeno.getState().yawRate) closes
// a yaw-rate loop like the fly's halteres, whose mechanosensory feedback enters the VNC: the turn
// command sets a desired yaw rate and the stride/hip-yaw asymmetry is servoed to reach it. Without
// it the gait is open-loop and drifts, because Leno's rig is not symmetric.
import { MUSCLE_DOFS } from './ragdoll.js';

const TAU = Math.PI * 2;
const clamp01 = (x) => (x > 0 ? (x < 1 ? x : 1) : 0);
const lerp = (a, b, t) => a + (b - a) * t;

export const VNC_TUNING = {
  stepHz: [0.9, 1.3],       // stride frequency at low / full drive (full cycles per second)
  hipAmp: 22,               // hip pitch swing amplitude (deg)
  hipBias: 0,               // mean hip flexion while walking (deg)
  hipLead: 0.5,             // hip phase lead over the knee (rad): the thigh swings forward while the knee is bent
  kneeSwing: 70,            // extra knee flexion in swing (deg)
  kneeStance: 6,            // knee flexion in stance while walking (deg)
  ankleSwing: 30,           // dorsiflexion in swing (toe clearance)
  pushOff: 22,              // plantarflexion at late stance
  turnYaw: 25,              // stance hip yaw sweep for turning (deg)
  turnStride: 0.7,          // stride-length asymmetry for turning
  backStride: 0.45,         // stride scale when walking backward
  maxYawRate: 0.9,          // rad/s at |turn| = 1 (with sense feedback)
  yawGain: 1.2,             // turn correction per rad/s of yaw-rate error
  yawTau: 0.6,              // s, yaw-rate averaging
  armSwing: 24,             // shoulder pitch swing (deg)
  armsDown: -30,            // shoulder roll that drops the A-pose arms to the sides
  tone: { leg: 0.35, walkLeg: 0.42, spine: 0.35, neck: 0.25, arm: 0.12 },
};

export class VNC {
  constructor(tuning = {}) {
    this.T = { ...VNC_TUNING, ...tuning };
    this.phase = 0;
    this.time = 0;
    this.gait = 0;
    this.c = { forward: 0, backward: 0, turn: 0, startle: 0, groom: 0, feed: 0 };
    this.angles = {};
    this.tone = {};
    this.out = {};
  }

  reset() { this.phase = 0; this.gait = 0; this.turnFb = 0; this.yawRateF = 0; for (const k in this.c) this.c[k] = 0; }

  update(dt, cmd = {}, sense = null) {
    const T = this.T, c = this.c;
    dt = Math.min(Math.max(dt, 0), 0.1);
    this.time += dt;
    // command smoothing (startle is fast)
    for (const k in c) {
      const tau = k === 'startle' ? 0.06 : 0.3;
      const target = k === 'turn' ? Math.max(-1, Math.min(1, cmd.turn ?? 0)) : clamp01(cmd[k] ?? 0);
      c[k] += (target - c[k]) * (1 - Math.exp(-dt / tau));
    }
    const t = this.time;

    // ---- gait oscillator
    const drive = clamp01(Math.max(c.forward, c.backward, Math.abs(c.turn) * 0.8));
    const dir = c.backward > c.forward ? -1 : 1;
    this.gait += (drive - this.gait) * (1 - Math.exp(-dt / 0.35));
    const g = this.gait;
    const hz = lerp(T.stepHz[0], T.stepHz[1], drive);
    if (g > 0.02) this.phase += dir * TAU * hz * dt;
    let turn = c.turn;
    if (sense && Number.isFinite(sense.yawRate) && g > 0.05) {
      // average over about a stride: the pelvis twists back and forth with every step
      this.yawRateF = (this.yawRateF ?? 0) + (sense.yawRate - (this.yawRateF ?? 0)) * (1 - Math.exp(-dt / T.yawTau));
      const err = turn * T.maxYawRate - this.yawRateF;
      this.turnFb = (this.turnFb ?? 0) + (T.yawGain * err - (this.turnFb ?? 0)) * (1 - Math.exp(-dt / 0.3));
      turn = Math.max(-1, Math.min(1, turn + this.turnFb));
    } else this.turnFb = 0;
    // stride scale: pure turning in place uses short steps
    const stride = (Math.max(c.forward, c.backward) > 0.05 ? 1 : 0.35) * (dir < 0 ? T.backStride : 1);

    const A = this.angles, N = this.tone;
    const set = (key, deg, tone) => { A[key] = deg; N[key] = tone; };

    // ---- idle stance + walk
    const legTone = lerp(T.tone.leg, T.tone.walkLeg, g);
    const gc = Math.min(1, g * 3);       // foot clearance is full as soon as stepping: slow walking = shorter strides
    for (const side of ['l', 'r']) {
      const ph = this.phase + (side === 'l' ? 0 : Math.PI);
      const sn = Math.sin(ph), cs = Math.cos(ph);
      const inner = side === 'l' ? turn : -turn;              // >0: this leg is on the inside of the turn
      const amp = T.hipAmp * stride * Math.max(0.2, 1 - T.turnStride * inner);
      const swing = Math.max(0, cs);                            // 0..1, peaks mid-swing
      const push = Math.pow(Math.max(0, Math.cos(ph + Math.PI / 2 + 0.45)), 4);
      set(`hip_${side}_pitch`, g * (amp * Math.sin(ph + T.hipLead * dir) + T.hipBias * dir), legTone);
      set(`knee_${side}_pitch`, 3 + gc * (T.kneeSwing * swing * swing + T.kneeStance), legTone);
      set(`ankle_${side}_pitch`, gc * (T.ankleSwing * Math.sqrt(swing) - T.pushOff * push * (dir > 0 ? 1 : 0.3)), legTone);
      set(`hip_${side}_roll`, 2 + g * 2 * Math.max(0, cs), legTone * 0.8);
      // physical +Y hip rotation sweeps the pelvis around the stance foot; yaw flex is +Y on the left, -Y on the right
      const yawPhys = dir * turn * T.turnYaw * sn * Math.min(1, g * 1.5);
      set(`hip_${side}_yaw`, side === 'l' ? yawPhys : -yawPhys, legTone * 0.8);

      // arms: drop from the A-pose, swing opposite to the same-side leg
      set(`shoulder_${side}_roll`, T.armsDown, T.tone.arm);
      set(`shoulder_${side}_pitch`, -g * T.armSwing * sn * stride, T.tone.arm);
      set(`shoulder_${side}_yaw`, 0, T.tone.arm);
      set(`elbow_${side}_pitch`, 12 + g * (10 + 8 * Math.max(0, -sn)), T.tone.arm);
    }
    set('spine_pitch', 3 + 5 * g * dir, T.tone.spine);
    set('spine_yaw', 10 * turn - 5 * g * Math.sin(this.phase), T.tone.spine);
    set('spine_roll', 0, T.tone.spine);
    set('neck_pitch', -2, T.tone.neck);
    set('neck_yaw', 30 * turn, T.tone.neck);

    // ---- feed / talk: lean in, nod, gesture
    const f = c.feed;
    if (f > 0.01) {
      const mix = (key, deg, tone) => { A[key] = lerp(A[key], deg, f); N[key] = Math.max(N[key], tone * f); };
      mix('spine_pitch', 18, 0.45);
      mix('neck_pitch', 8 + 12 * Math.sin(TAU * 4.2 * t) + 5 * Math.sin(TAU * 6.7 * t), 0.45);
      mix('neck_yaw', A.neck_yaw + 12 * Math.sin(TAU * 0.6 * t), 0.3);
      for (const side of ['l', 'r']) {
        const o = side === 'l' ? 0 : 2.1;
        mix(`shoulder_${side}_pitch`, 40 + 22 * Math.sin(TAU * 1.3 * t + o), 0.35);
        mix(`shoulder_${side}_roll`, -12 + 10 * Math.sin(TAU * 0.9 * t + o), 0.35);
        mix(`shoulder_${side}_yaw`, 20, 0.3);
        mix(`elbow_${side}_pitch`, 75 + 25 * Math.sin(TAU * 1.7 * t + o), 0.35);
      }
    }

    // ---- groom: both hands to the face and rub (like a fly's front legs cleaning the antennae)
    const gr = c.groom;
    if (gr > 0.01) {
      const mix = (key, deg, tone) => { A[key] = lerp(A[key], deg, gr); N[key] = Math.max(N[key], tone * gr); };
      mix('neck_pitch', 22, 0.4);
      mix('spine_pitch', 10, 0.4);
      for (const side of ['l', 'r']) {
        const o = side === 'l' ? 0 : Math.PI;
        const rub = Math.sin(TAU * 3.2 * t + o);
        mix(`shoulder_${side}_pitch`, 52 + 8 * rub, 0.5);
        mix(`shoulder_${side}_roll`, -20, 0.5);
        mix(`shoulder_${side}_yaw`, 35 + 10 * rub, 0.5);
        mix(`elbow_${side}_pitch`, 135 + 10 * Math.sin(TAU * 3.2 * t + o + 1.2), 0.5);
      }
    }

    // ---- startle (giant fiber): legs extend, tiptoe, arms fly up, head back
    const st = c.startle;
    if (st > 0.01) {
      const mix = (key, deg, tone) => { A[key] = lerp(A[key], deg, st); N[key] = Math.max(N[key], tone * st); };
      for (const side of ['l', 'r']) {
        mix(`hip_${side}_pitch`, -6, 0.7);
        mix(`knee_${side}_pitch`, 0, 0.7);
        mix(`ankle_${side}_pitch`, -28, 0.7);
        mix(`hip_${side}_roll`, 6, 0.6);
        mix(`shoulder_${side}_roll`, 88, 0.6);
        mix(`shoulder_${side}_pitch`, 45, 0.6);
        mix(`shoulder_${side}_yaw`, -10, 0.5);
        mix(`elbow_${side}_pitch`, 20, 0.5);
      }
      mix('spine_pitch', -14, 0.7);
      mix('neck_pitch', -22, 0.6);
    }

    // ---- angles -> antagonistic activations
    const out = this.out;
    for (const d of MUSCLE_DOFS) {
      const deg = A[d.key] ?? 0, tone = N[d.key] ?? 0;
      const u = deg >= 0 ? (d.max > 0 ? deg / d.max : 0) : (d.min < 0 ? -deg / d.min : 0);
      out[d.key + '_flex'] = clamp01(tone + Math.max(u, 0));
      out[d.key + '_ext'] = clamp01(tone + Math.max(-u, 0));
    }
    return out;
  }
}
