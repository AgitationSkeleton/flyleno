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

const clamp01 = (x) => Math.max(0, Math.min(1, x));

// muscle postures for one-shot gestures (added to the activations, scaled by an envelope)
const GESTURES = {
  retch: { spine_pitch_flex: 0.9, neck_pitch_flex: 0.5, shoulder_l_pitch_flex: 0.5, shoulder_r_pitch_flex: 0.5, elbow_l_pitch_flex: 0.9, elbow_r_pitch_flex: 0.9, knee_l_pitch_flex: 0.3, knee_r_pitch_flex: 0.3 },
  vomit: { spine_pitch_flex: 1, neck_pitch_flex: 0.8, shoulder_l_pitch_flex: 0.3, shoulder_r_pitch_flex: 0.3, elbow_l_pitch_flex: 0.6, elbow_r_pitch_flex: 0.6, knee_l_pitch_flex: 0.4, knee_r_pitch_flex: 0.4 },
  fart: { spine_pitch_flex: 0.5, hip_l_pitch_flex: 0.35, hip_r_pitch_flex: 0.35, knee_l_pitch_flex: 0.5, knee_r_pitch_flex: 0.5, neck_yaw_flex: 0.8 },
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
    this.lastStartle = 0;
    this.activation = {};
    this.onFall = null;
    this.keepOnStage = false;         // true: body reflex keeps Leno on the platform top
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
    // room walls around the floor
    const box = new THREE.Box3();
    for (const m of stage.ground) box.expandByObject(m);
    const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
    const H = 12, T = 1;
    for (const [x, z, hx, hz] of [[c.x - sz.x / 2 - T, c.z, T, sz.z / 2 + T], [c.x + sz.x / 2 + T, c.z, T, sz.z / 2 + T],
      [c.x, c.z - sz.z / 2 - T, sz.x / 2 + T, T], [c.x, c.z + sz.z / 2 + T, sz.x / 2 + T, T]]) {
      world.createCollider(R.ColliderDesc.cuboid(hx, H, hz).setTranslation(x, box.min.y + H, z).setCollisionGroups(G));
    }
    this.worldBox = box;
  }

  groundAt(p) {
    const R = this.RAPIER;
    const ray = new R.Ray({ x: p.x, y: p.y + 6, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 30, true, undefined, undefined, undefined, this.rag.bodies.pelvis);
    return hit ? p.y + 6 - (hit.timeOfImpact ?? hit.toi) : null;
  }

  // ---- interface shared with the kinematic Leno
  setMotor(cmd) { Object.assign(this.cmd, cmd); }
  setPools(rates) { this.poolRates = rates || {}; }
  trigger(kind) { this.gesture = { kind, t: 0, dur: { retch: 0.9, vomit: 1.6, fart: 0.8 }[kind] || 1 }; }
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
    const act = this.activation;
    for (const name of MUSCLE_NAMES) {
      const direct = clamp01((this.poolRates[name] || 0) / this.directGain);
      act[name] = clamp01(this.vncWeight * (vnc[name] || 0) + this.directWeight * direct + (g?.[name] || 0) * env);
    }
    this.rag.setActivations(act);
    this.rag.setSupport(this.support);
    this.rag.step(dt);
    this.rag.syncSkin();

    // fallen for too long: stagehands stand him back up
    this.fallenFor = st.fallen ? this.fallenFor + dt : 0;
    if (st.fallen && this.fallenFor > 0 && this.fallenFor - dt <= 0) this.onFall?.();
    if (this.fallenFor > 5) {
      this.fallenFor = 0;
      // stand him up where he fell (ground height found by a ray), or back on stage if lost
      const p = st.root.clone();
      const hit = this.groundAt(p);
      if (hit === null || (this.worldBox && !this.worldBox.containsPoint(p.clone().setY(this.worldBox.min.y + 0.1)))) p.copy(this.home);
      else p.y = hit;
      this.rag.place(p, st.heading);
    }
  }
}
