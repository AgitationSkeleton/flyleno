// Physics body for Leno: the ragdoll (js/ragdoll.js) driven by the fly.
//
// Each of the 46 muscles gets
//   activation = clamp( vncWeight * VNC(motor command)  +  directWeight * sat(DN pool rate / directGain) + gesture )
// where the DN pool is that muscle's own set of real descending neurons (data/neurons.json -> muscles), and
// the VNC is a central pattern generator standing in for the fly's ventral nerve cord (not in the brain
// connectome). "Puppet strings" (support) hold Leno up; at 0 he is a pure ragdoll.
// Exposes the same helpers the rest of the app uses on the kinematic Leno (forward, mouth, butt, trigger...).
import * as THREE from 'three';
import { initPhysics, RagdollLeno, MUSCLE_NAMES } from './ragdoll.js';
import { VNC } from './vnc.js';
import { addSetColliders } from './colliders.js';

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// muscle postures for one-shot gestures (added to the activations, scaled by an envelope)
const GESTURES = {
  retch: { spine_pitch_flex: 0.9, neck_pitch_flex: 0.5, shoulder_l_pitch_flex: 0.5, shoulder_r_pitch_flex: 0.5, elbow_l_pitch_flex: 0.9, elbow_r_pitch_flex: 0.9, knee_l_pitch_flex: 0.3, knee_r_pitch_flex: 0.3 },
  vomit: { spine_pitch_flex: 1, neck_pitch_flex: 0.8, shoulder_l_pitch_flex: 0.3, shoulder_r_pitch_flex: 0.3, elbow_l_pitch_flex: 0.6, elbow_r_pitch_flex: 0.6, knee_l_pitch_flex: 0.4, knee_r_pitch_flex: 0.4 },
  lay: { spine_pitch_flex: 0.6, hip_l_pitch_flex: 0.5, hip_r_pitch_flex: 0.5, knee_l_pitch_flex: 0.8, knee_r_pitch_flex: 0.8, neck_pitch_flex: 0.4 },
  fart: { spine_pitch_flex: 0.5, hip_l_pitch_flex: 0.35, hip_r_pitch_flex: 0.35, knee_l_pitch_flex: 0.5, knee_r_pitch_flex: 0.5, neck_yaw_flex: 0.8 },
};

// sustained postures (weight 0..1, smoothed), e.g. from js/instincts.js
export const POSTURES = {
  // feeding: kneel (hips + knees fully bent), pitch the torso forward, down onto his forearms, face to the food on
  // the floor (like a fly putting its mouthparts on it): his mouth gets to ~0.25 m, right at the food
  eat: { hip_l_pitch_flex: 0.85, hip_r_pitch_flex: 0.85, knee_l_pitch_flex: 0.66, knee_r_pitch_flex: 0.66,
    ankle_l_pitch_ext: 0.8, ankle_r_pitch_ext: 0.8, spine_pitch_flex: 0.35, neck_pitch_flex: 0.8,
    shoulder_l_pitch_flex: 0.55, shoulder_r_pitch_flex: 0.55, elbow_l_pitch_flex: 0.8, elbow_r_pitch_flex: 0.8 },
  // fly-like leg rubbing: forearms up in front of the chest, hands together (oscillation added in update)
  rub: { shoulder_l_pitch_flex: 0.45, shoulder_r_pitch_flex: 0.45, shoulder_l_roll_ext: 0.45, shoulder_r_roll_ext: 0.45,
    elbow_l_pitch_flex: 0.75, elbow_r_pitch_flex: 0.75, shoulder_l_yaw_flex: 0.4, shoulder_r_yaw_flex: 0.4, neck_pitch_flex: 0.25 },
  // asleep (js/sleep.js): curled up on his knees, forehead to the floor, arms tucked (a child's pose); the puppet
  // strings lower him all the way into it
  sleep: { hip_l_pitch_flex: 0.9, hip_r_pitch_flex: 0.9, knee_l_pitch_flex: 0.7, knee_r_pitch_flex: 0.7,
    ankle_l_pitch_ext: 0.8, ankle_r_pitch_ext: 0.8, spine_pitch_flex: 0.6, neck_pitch_flex: 0.85,
    shoulder_l_pitch_flex: 0.45, shoulder_r_pitch_flex: 0.45, elbow_l_pitch_flex: 0.55, elbow_r_pitch_flex: 0.55 },
};

// how the puppet strings hold him in a sustained posture: drop (share of standing height they lower him by), lean
// (m forward of his feet for the chest), pitch (rad, pelvis tipped forward), headFree (0..1: the head string lets go).
// For eating and sleeping they lower him all the way and let his head go, so the strings never hold him up out of
// the posture (at any strength of the support slider)
export const STANCE = {
  eat: { drop: 0.66, lean: 0.5, pitch: 1.45, headFree: 1 },
  sleep: { drop: 0.72, lean: 0.55, pitch: 1.4, headFree: 1 },
};

export class PhysicsLeno {
  constructor(leno) {
    this.leno = leno;                 // kinematic Leno instance (used only as the model loader)
    this.vnc = new VNC();
    this.vncWeight = 1;
    this.directWeight = 1;
    this.directGain = 30;             // Hz at which a DN muscle pool saturates its muscle
    this.support = 0.8;
    this.cmd = { forward: 0, backward: 0, turn: 0, startle: 0, groom: 0, feed: 0 };
    this.poolRates = {};
    this.gesture = null;
    this.fallenFor = 0;
    this.getUp = 0;                    // 0..1: puppet strings helping him up after a fall
    this.slackAmt = 0; this.slackUntil = 0; this.slack = 0;   // strings loosened by a knock (0 = taut, 1 = cut)
    this.heldUntil = 0;                // performance.now() ms while a predator holds him
    this.lastStartle = 0;
    this.activation = {};
    this.onFall = null;
    this.keepOnStage = false;         // true: body reflex keeps Leno on the platform top
    this.posture = { eat: 0, rub: 0, sleep: 0 }; this.postureTarget = { eat: 0, rub: 0, sleep: 0 };
    this.t = 0;
  }

  async init(stage, hostPos) {
    const { RAPIER, world } = await initPhysics();
    this.world = world; this.RAPIER = RAPIER;
    this.stageCenter = new THREE.Vector3().fromArray(stage.markers.stageCenter.position);
    const b = stage.markers.stageCenter;
    this.stageRadius = b.boundsMax && b.boundsMin ? (b.boundsMax[0] - b.boundsMin[0]) / 2 : 7.3;
    // the kinematic rig must not touch the bones any more: detach its root transform
    this.leno.root.position.set(0, 0, 0); this.leno.root.quaternion.identity();
    this.leno.root.updateMatrixWorld(true);
    this.rag = new RagdollLeno({ RAPIER, world, model: this.leno.model, groundMeshes: stage.ground });
    this.home = hostPos.clone();
    this.rag.place(hostPos, 0);
    this.state = this.rag.getState();
    this.addObstacles(stage);
    return this;
  }

  /** Solid seat rows (floor up to seat-back height, so raised tiers are solid too) and room walls. */
  addObstacles(stage) {
    const R = this.RAPIER, world = this.world;
    const G = ((1 & 0xffff) << 16) | 0xffff;           // "ground" group, collides with everything
    const rows = {};
    for (const a of stage.markers.audience) (rows[a.row] ||= []).push(a);
    const floorY = Math.min(...stage.markers.audience.map((a) => a.position[1]));
    for (const seats of Object.values(rows)) {
      seats.sort((a, b) => a.seat - b.seat);
      const p0 = new THREE.Vector3().fromArray(seats[0].position), p1 = new THREE.Vector3().fromArray(seats[seats.length - 1].position);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      const along = p1.clone().sub(p0).setY(0);
      const len = along.length() + 1.0, top = mid.y + 1.25, bottom = floorY - 0.05;
      const yaw = Math.atan2(along.x, along.z);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      world.createCollider(R.ColliderDesc.cuboid(0.45, (top - bottom) / 2, len / 2)
        .setTranslation(mid.x, (top + bottom) / 2, mid.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setFriction(0.8).setCollisionGroups(G));
    }
    // the whole set (walls, curtains, risers, props, letters, truss, toilets, screens, ceiling) + room bounds
    const res = addSetColliders(R, world, stage);
    this.worldBox = res.room;
    console.log(`[flyleno] set colliders: ${res.tris | 0} triangles, ${res.boxes} boxes`);
  }

  groundAt(p) {
    const R = this.RAPIER;
    const ray = new R.Ray({ x: p.x, y: p.y + 6, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 30, true, undefined, undefined, undefined, this.rag.bodies.pelvis);
    return hit ? p.y + 6 - (hit.timeOfImpact ?? hit.toi) : null;
  }

  // ---- interface shared with the kinematic Leno
  setMotor(cmd) { Object.assign(this.cmd, cmd); }
  /** the puppeteer leads him toward `dir` (unit, horizontal) with strength 0..1, or stops (null) */
  guide(dir, strength = 0) { this.guideDir = dir ? dir.clone() : null; this.guideK = strength; }

  /** knocked: the puppet strings go slack (amount 0..1) for `sec` seconds, then tighten again gradually */
  loosen(amount = 0.8, sec = 0.8) {
    const now = performance.now();
    if (now > this.slackUntil) this.slackAmt = 0;
    this.slackAmt = Math.max(this.slackAmt, Math.min(1, amount));
    this.slackUntil = Math.max(this.slackUntil, now + sec * 1000);
  }
  setPools(rates) { this.poolRates = rates || {}; }
  setPosture(p) { Object.assign(this.postureTarget, p); }
  trigger(kind) { this.gesture = { kind, t: 0, dur: { retch: 0.9, vomit: 1.6, fart: 0.8, lay: 1.4 }[kind] || 1 }; }
  get position() { return this.state.root; }
  forward() { return new THREE.Vector3(Math.sin(this.state.heading), 0, Math.cos(this.state.heading)); }
  mouth() { return this.state.mouthPos.clone(); }
  butt() { return this.state.buttPos.clone(); }
  headDown() { return this.forward().multiplyScalar(0.8).add(new THREE.Vector3(0, -0.6, 0)).normalize(); }

  update(dt) {
    const st = this.state = this.rag.getState();
    const cmd = { ...this.cmd };

    // stage-edge reflex (body, not neural): keep to the top disc of the platform (the outer radius
    // includes the steps). Near the rim, turn back / stop backing out; past it, the puppet strings
    // tug him back toward the centre.
    const toC = this.stageCenter.clone().sub(st.root).setY(0);
    const dist = toC.length(), limit = this.stageRadius * 0.78;
    if (this.keepOnStage && dist > limit - 1) {
      const f = this.forward();
      const side = f.z * toC.x - f.x * toC.z;                 // >0: centre is to Leno's left (+turn)
      if (f.dot(toC) < 0) { cmd.turn = Math.sign(side || 1); cmd.forward *= 0.3; }
      else cmd.backward = 0;
      if (dist > limit) this.rag.applyImpulse('pelvis', toC.normalize().multiplyScalar(60 * (dist - limit + 0.5) * dt * 60 * (0.3 + this.support)));
    }

    // startle: a kick upward on a fresh giant-fiber volley
    if (cmd.startle > 0.6 && performance.now() - this.lastStartle > 1500) {
      this.lastStartle = performance.now();
      this.rag.applyImpulse('pelvis', new THREE.Vector3(0, 380, 0));
    }

    const vnc = this.vnc.update(dt, cmd, { yawRate: st.yawRate });
    let g = null, env = 0;
    if (this.gesture) {
      this.gesture.t += dt;
      const u = this.gesture.t / this.gesture.dur;
      env = Math.sin(Math.PI * Math.min(1, u));
      g = GESTURES[this.gesture.kind];
      if (u >= 1) this.gesture = null;
    }
    this.t += dt;
    for (const k in this.posture) this.posture[k] += ((this.postureTarget[k] || 0) - this.posture[k]) * Math.min(1, dt * 3);
    const P = this.posture, rubOsc = 0.25 * Math.sin(this.t * 13);
    const act = this.activation;
    for (const name of MUSCLE_NAMES) {
      const direct = clamp01((this.poolRates[name] || 0) / this.directGain);
      let pose = 0;
      for (const k in POSTURES) pose += (POSTURES[k][name] || 0) * P[k];
      if (P.rub > 0.05 && /elbow_[lr]_pitch_flex/.test(name)) pose += rubOsc * (name.includes('_l_') ? 1 : -1) * P.rub;
      // postures take over from the gait pattern while they are held
      // (asleep, his muscles relax: the brain's descending drive reaches them only weakly)
      const vncW = this.vncWeight * (1 - 0.8 * Math.max(P.eat, P.rub * 0.5, P.sleep));
      act[name] = clamp01(vncW * (vnc[name] || 0) + this.directWeight * direct * (1 - 0.8 * P.sleep) + (g?.[name] || 0) * env + pose);
    }
    this.rag.setActivations(act);
    // the puppet strings let him crouch down to eat
    // eating on all fours: the puppet strings lower him, lean him forward over his hands and tip the pelvis
    // led home by the strings: the puppeteer carries the whole puppet along slowly (every body part together, so
    // the pose isn't pulled apart), toward a walking pace of up to ~0.7 m/s; not while he's down, held or slack
    if (this.guideDir && !st.fallen && this.heldUntil < performance.now()) {
      const k = this.guideK * Math.min(1, this.support / 0.5) * (1 - this.slack);
      if (k > 0.01) {
        const pv = this.rag.bodies.pelvis.linvel(), along = pv.x * this.guideDir.x + pv.z * this.guideDir.z;
        const acc = Math.max(0, Math.min(5, (0.8 * k - along) * 10));           // m/s² toward the target pace (enough to overcome the feet's grip)
        if (acc > 0) for (const b of Object.values(this.rag.bodies)) {
          const m = b.mass() * acc * dt;
          b.applyImpulse({ x: this.guideDir.x * m, y: 0, z: this.guideDir.z * m }, true);
        }
      }
    }
    // slack: drops fast when he's hit, comes back over about a second
    const slackWant = performance.now() < this.slackUntil ? this.slackAmt : 0;
    this.slack += (slackWant - this.slack) * Math.min(1, dt * (slackWant > this.slack ? 25 : 1.8));
    const low = Math.max(P.eat, P.sleep);
    this.rag.setSupport(Math.min(1, this.support * (1 - 0.35 * low) * (1 + 0.6 * this.getUp)) * (1 - this.slack));
    const stn = (f) => Object.keys(STANCE).reduce((a, k) => a + (P[k] || 0) * STANCE[k][f], 0);
    this.rag.setStance?.(stn('drop'), stn('lean'), stn('pitch'), Math.min(1, stn('headFree')));
    this.rag.step(dt);
    this.rag.syncSkin();

    // fallen: he stays in whatever pose he landed in (no snapping upright). After a while on the floor the puppet
    // strings help him up gradually, physically. Being low on all fours while eating, or dangling in a predator's
    // grip, isn't a fall. Only if he has left the set entirely is he put back on stage.
    const held = this.heldUntil > performance.now();
    // waking up curled on the floor isn't a fall: the strings start helping him up straight away
    if (this.posture.sleep > 0.3) this.sleptLow = st.fallen;
    else if (this.sleptLow) { this.sleptLow = false; if (st.fallen) this.fallenFor = 4.01; }
    const down = st.fallen && this.posture.eat < 0.3 && this.posture.sleep < 0.3 && !held;
    this.fallenFor = down ? this.fallenFor + dt : 0;
    if (down && this.fallenFor > 0 && this.fallenFor - dt <= 0) this.onFall?.();
    // (the help comes from the strings, so with the strings off he just lies there: a pure ragdoll)
    this.getUp = this.fallenFor > 4 && this.support > 0.05 ? Math.min(1, this.getUp + dt * 0.4) : Math.max(0, this.getUp - dt * 0.8);
    if (this.getUp > 0) this.rag.applyImpulse('chest', new THREE.Vector3(0, this.getUp * Math.min(1, this.support / 0.8) * 0.5 * 81 * 9.81 * dt, 0));
    const p = st.root;
    const lost = this.worldBox && !this.worldBox.containsPoint(p.clone().setY(this.worldBox.min.y + 0.1));
    if (lost) {
      this.fallenFor = 0; this.getUp = 0;
      this.rag.place(this.home, st.heading);
    }
  }
}
