// Grey Leno: skinned model + procedural "puppet" rig driven by the fly's motor outputs.
//
// Motor command (all smoothed here, produced by js/motor.js from descending-neuron rates):
//   forward   0..1   walk forward          (fly: P9 / oDN1 / BPN forward walking)
//   backward  0..1   walk backward         (fly: MDN "moonwalker")
//   turn     -1..1   + = turn left         (fly: DNa01/DNa02 left-right asymmetry)
//   startle   0..1   jump / flinch         (fly: giant fiber DNp01)
//   groom     0..1   hands to face         (fly: antennal grooming aDN1/aDN2)
//   feed      0..1   lean in & "talk"      (fly: proboscis extension MN9)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// The TUURD set is built at roughly 1.4x human scale (seat pitch 0.77 m); match Leno to it.
export const HOST_SCALE = 1.35;
const WALK_SPEED = 1.6;          // m/s at forward = 1 (in stage units)
const TURN_RATE = 2.2;           // rad/s at |turn| = 1
const STAGE_MIN_Y = 1.0;         // ground ray must hit above this to count as "on stage"

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _fwd = new THREE.Vector3();

export class Leno {
  /** opts.scale: model scale (host 1.35; hatchlings smaller); opts.minY: ground must be above this (stage) */
  constructor(opts = {}) {
    this.scale = opts.scale ?? HOST_SCALE;
    this.minY = opts.minY ?? STAGE_MIN_Y;
    this.root = new THREE.Group();
    this.root.name = 'GreyLenoHost';
    this.motor = { forward: 0, backward: 0, turn: 0, startle: 0, groom: 0, feed: 0 };
    this.s = { ...this.motor };            // smoothed
    this.phase = 0;                        // walk cycle phase
    this.jump = 0;                         // vertical jump offset
    this.jumpVel = 0;
    this.time = 0;
    this.speed = 0;
    this.yawRate = 0;
    this.ray = new THREE.Raycaster();
    this.ground = [];
    this.home = new THREE.Vector3();
  }

  async load(url = 'assets/grey_leno.glb', onProgress) {
    const gltf = await new GLTFLoader().loadAsync(url, (e) => onProgress?.('leno', e));
    return this.setModel(gltf.scene);
  }

  /** use an already loaded Leno scene (cloned, so several Lenos can share one download) */
  fromScene(scene) { return this.setModel(cloneSkinned(scene)); }

  setModel(scene) {
    this.model = scene;
    this.model.scale.setScalar(this.scale);
    this.model.traverse((o) => {
      if (o.isSkinnedMesh) { o.frustumCulled = false; o.castShadow = true; }
      if (o.isBone) o.userData.rest = o.quaternion.clone();
    });
    this.root.add(this.model);
    const b = (n) => this.model.getObjectByName(n);
    this.bones = {
      pelvis: b('pelvis'), spine1: b('spine_01'), spine2: b('spine_02'), spine3: b('spine_03'),
      neck: b('neck_01'), head: b('head'),
      upperarm_l: b('upperarm_l'), lowerarm_l: b('lowerarm_l'), hand_l: b('hand_l'),
      upperarm_r: b('upperarm_r'), lowerarm_r: b('lowerarm_r'), hand_r: b('hand_r'),
      thigh_l: b('thigh_l'), calf_l: b('calf_l'), foot_l: b('foot_l'),
      thigh_r: b('thigh_r'), calf_r: b('calf_r'), foot_r: b('foot_r'),
    };
    this.allBones = [];
    this.model.traverse((o) => { if (o.isBone) this.allBones.push(o); });
    // Rest directions (model space) of the upper arms, used to drop the A-pose to the sides.
    this.model.updateMatrixWorld(true);
    this.restArmDir = {
      l: this.modelDir(this.bones.upperarm_l, this.bones.lowerarm_l),
      r: this.modelDir(this.bones.upperarm_r, this.bones.lowerarm_r),
    };
    this.setupMouth();
    return this;
  }

  // ---- lip-sync: the MouthOpen shape key (added by tools/export_leno.py), driven by setMouth(0..1)
  setupMouth() {
    this.mouthOpen = 0;
    this.morphs = [];
    this.model.traverse((o) => {
      const i = o.morphTargetDictionary?.MouthOpen;
      if (i !== undefined) this.morphs.push([o, i]);
    });
    this.setMouth(0);
  }

  setMouth(v) {
    this.mouthOpen = v;
    for (const [o, i] of this.morphs) o.morphTargetInfluences[i] = v;
  }
  place(hostMarker, groundMeshes, stageCenter) {
    this.ground = groundMeshes;
    const p = hostMarker.position;
    this.root.position.set(p[0], p[1], p[2]);
    this.root.quaternion.fromArray(hostMarker.quaternion ?? [0, 0, 0, 1]);
    this.home.copy(this.root.position);
    if (stageCenter) this.home.set(stageCenter.position[0], p[1], stageCenter.position[2]);
    const y = this.groundHeight(this.root.position);
    if (y !== null) this.root.position.y = y;
  }

  groundHeight(pos) {
    if (!this.ground.length) return null;
    this.ray.set(_v.set(pos.x, pos.y + 5, pos.z), _v2.set(0, -1, 0));
    this.ray.far = 20;
    const hit = this.ray.intersectObjects(this.ground, false)[0];
    return hit ? hit.point.y : null;
  }

  // direction from bone a to bone b in the model's (unscaled) frame
  modelDir(a, b) {
    const pa = a.getWorldPosition(new THREE.Vector3());
    const pb = b.getWorldPosition(new THREE.Vector3());
    const inv = this.root.matrixWorld.clone().invert();
    return pb.applyMatrix4(inv).sub(pa.applyMatrix4(inv)).normalize();
  }

  /** Rotate a bone by quaternion `qm` expressed in the character's model frame. */
  rotateModel(bone, qm) {
    if (!bone) return;
    const rootQ = this.root.getWorldQuaternion(_q2);
    const rw = _q.copy(rootQ).multiply(qm).multiply(rootQ.clone().invert()); // model -> world
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
    // L' = P^-1 * Rw * P * L
    const l = parentQ.clone().invert().multiply(rw).multiply(parentQ).multiply(bone.quaternion);
    bone.quaternion.copy(l);
    bone.updateMatrixWorld(true);
  }

  rot(bone, axis, angle) { this.rotateModel(bone, new THREE.Quaternion().setFromAxisAngle(axis, angle)); }

  setMotor(m) { Object.assign(this.motor, m); }
  setPosture(p) { this.posture = p; }

  /** One-shot body gestures triggered by behaviour: 'retch' | 'vomit' | 'fart'. */
  trigger(kind) { this.gesture = { kind, t: 0, dur: { retch: 0.9, vomit: 1.6, fart: 0.8, lay: 1.4 }[kind] || 1 }; }

  /** World positions/directions for effects. */
  mouth() {
    const h = this.bones.head.getWorldPosition(new THREE.Vector3());
    return h.addScaledVector(this.forward(), 0.25 * this.scale).add(new THREE.Vector3(0, -0.05, 0));
  }
  butt() {
    const p = this.bones.pelvis.getWorldPosition(new THREE.Vector3());
    return p.addScaledVector(this.forward(), -0.2 * this.scale);
  }
  forward() { return new THREE.Vector3(0, 0, 1).applyQuaternion(this.root.quaternion); }
  headDown() {
    return this.forward().multiplyScalar(0.8).add(new THREE.Vector3(0, -0.6, 0)).normalize();
  }

  update(dt) {
    if (!this.model) return;
    this.time += dt;
    const k = 1 - Math.exp(-dt * 6);
    const target = this.override ?? this.motor;   // override: debug / manual puppeteering
    for (const key in this.motor) this.s[key] += ((target[key] ?? 0) - this.s[key]) * k;
    const s = this.s;

    // ---- locomotion on the stage
    const targetSpeed = (s.forward - s.backward) * WALK_SPEED * (this.scale / HOST_SCALE);
    this.speed += (targetSpeed - this.speed) * k;
    this.yawRate += (s.turn * TURN_RATE - this.yawRate) * k;
    this.root.rotateY(this.yawRate * dt);
    const fwd = _fwd.set(0, 0, 1).applyQuaternion(this.root.quaternion);
    const next = this.root.position.clone().addScaledVector(fwd, this.speed * dt);
    const gy = this.groundHeight(next);
    if (gy !== null && gy > this.minY) {
      this.root.position.x = next.x; this.root.position.z = next.z;
      this.root.position.y += (gy - this.root.position.y) * Math.min(1, dt * 12);
      this.blocked = false;
    } else {
      // Stage edge: body reflex (not neural) - stop and pivot back toward the stage centre,
      // like a fly deflecting off an arena wall.
      this.blocked = true;
      this.speed *= 0.5;
      const toC = _v2.copy(this.home).sub(this.root.position).setY(0).normalize();
      const side = fwd.z * toC.x - fwd.x * toC.z; // >0: centre is toward +X, i.e. a +Y rotation
      this.root.rotateY(Math.sign(side || 1) * TURN_RATE * 0.8 * dt);
    }

    // ---- startle jump (giant fiber)
    if (s.startle > 0.5 && this.jump <= 0.001 && this.jumpVel === 0) this.jumpVel = 4.5 * Math.min(1, s.startle);
    if (this.jumpVel !== 0 || this.jump > 0) {
      this.jumpVel -= 14 * dt;
      this.jump = Math.max(0, this.jump + this.jumpVel * dt);
      if (this.jump === 0 && this.jumpVel < 0) this.jumpVel = 0;
    }
    this.model.position.y = this.jump;

    this.pose(dt);
  }

  pose(dt) {
    const s = this.s, B = this.bones;
    for (const b of this.allBones) b.quaternion.copy(b.userData.rest);
    this.model.updateMatrixWorld(true);

    const gait = Math.min(1, Math.abs(this.speed) / (WALK_SPEED * this.scale / HOST_SCALE) + Math.abs(this.yawRate) / TURN_RATE * 0.5);
    this.phase += dt * (2 + 5 * gait) * Math.sign(this.speed || 1);
    const sw = Math.sin(this.phase) * gait;
    const breathe = Math.sin(this.time * 1.7) * 0.02;

    // spine: lean into walking / feeding, twist with turning
    this.rot(B.spine1, X, 0.05 * gait + 0.25 * s.feed + breathe);
    this.rot(B.spine2, Y, -0.15 * Math.tanh(this.yawRate));
    this.rot(B.spine3, X, 0.1 * s.feed - 0.2 * s.startle);

    // head: look where we're turning, nod when "talking" (feed), jitter when startled
    const talk = s.feed * (0.18 * Math.sin(this.time * 11) + 0.08 * Math.sin(this.time * 17));
    this.rot(B.neck, Y, 0.35 * Math.tanh(this.yawRate * 0.8));
    this.rot(B.head, X, talk + 0.1 * s.groom - 0.25 * s.startle);

    // arms: A-pose -> hanging at sides (+ swing, grooming, startle)
    for (const side of ['l', 'r']) {
      const sign = side === 'l' ? 1 : -1;
      const up = B['upperarm_' + side], lo = B['lowerarm_' + side];
      const rest = this.restArmDir[side];
      const down = new THREE.Vector3(0.18 * sign, -1, 0.05).normalize();
      this.rotateModel(up, new THREE.Quaternion().setFromUnitVectors(rest, down));
      // walking swing (opposite to legs)
      this.rot(up, X, -0.45 * sw * sign);
      // grooming: raise forearms to the face and rub
      if (s.groom > 0.01) {
        this.rot(up, X, -1.2 * s.groom);
        this.rot(up, Z, -0.35 * sign * s.groom);
        this.rot(lo, X, -1.6 * s.groom + 0.25 * s.groom * Math.sin(this.time * 14 + sign));
      }
      // startle: arms fly up
      if (s.startle > 0.01) this.rot(up, Z, 2.4 * sign * s.startle);
      // talking hands
      if (s.feed > 0.01) this.rot(lo, X, -0.6 * s.feed * (0.6 + 0.4 * Math.sin(this.time * 5 + sign * 2)));
    }

    // legs: walk cycle (forward swing = rotate about -X for a +Z-facing character)
    for (const side of ['l', 'r']) {
      const ph = side === 'l' ? sw : -sw;
      this.rot(B['thigh_' + side], X, -0.55 * ph);
      const knee = Math.max(0, -Math.cos(this.phase + (side === 'l' ? 0 : Math.PI))) * gait;
      this.rot(B['calf_' + side], X, 0.9 * knee + 0.5 * s.startle);
      this.rot(B['thigh_' + side], X, -0.4 * s.startle);
    }
    // one-shot gestures
    const G = this.gesture;
    if (G) {
      G.t += dt;
      const u = Math.min(1, G.t / G.dur), env = Math.sin(Math.PI * u);
      if (G.kind === 'retch' || G.kind === 'vomit') {
        const k = G.kind === 'vomit' ? 1.3 : 1;
        const heave = env * k * (0.8 + 0.2 * Math.sin(G.t * 30));
        this.rot(B.spine1, X, 0.55 * heave);
        this.rot(B.spine2, X, 0.35 * heave);
        this.rot(B.head, X, 0.25 * heave);
        for (const side of ['l', 'r']) {           // hands to the belly
          this.rot(B['upperarm_' + side], X, -0.7 * env);
          this.rot(B['lowerarm_' + side], X, -1.3 * env);
        }
      } else if (G.kind === 'fart' || G.kind === 'lay') {
        this.rot(B.spine1, X, 0.3 * env);                  // lean forward, stick it out
        this.rot(B.neck, Y, 0.9 * env);                    // look over the shoulder
        this.rot(B.thigh_l, X, -0.25 * env); this.rot(B.thigh_r, X, -0.25 * env);
        this.rot(B.calf_l, X, 0.4 * env); this.rot(B.calf_r, X, 0.4 * env);
      }
      if (u >= 1) this.gesture = null;
    }
    // bob
    this.model.position.y += Math.abs(Math.sin(this.phase)) * 0.06 * gait;
  }
}
