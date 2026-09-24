// Grey Leno as a physics "active ragdoll" (Rapier). Every joint DOF is driven by an antagonistic
// flexor/extensor muscle pair (activations 0..1) that sets a PD joint motor:
//
//   target    = rest + d * range,  d = a_flex - a_ext   (d > 0 -> toward max, d < 0 -> toward min)
//   stiffness = S_joint * (K_BASE + K_GAIN * (a_flex + a_ext))      co-contraction stiffens the joint
//   damping   = DAMP_RATIO * stiffness + passive
//
// A silent brain (all activations 0) leaves every joint limp; without "puppet strings"
// (setSupport) Leno then collapses. Layout: tools/body_spec.json (mirrored in BODY_SPEC below).
// Docs: docs/ragdoll.md.
import * as THREE from 'three';

export const RAPIER_VERSION = '0.19.3';
export const RAPIER_URL = `https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@${RAPIER_VERSION}/+esm`;
export const FIXED_DT = 1 / 120;

// ---------------------------------------------------------------------------------------------
// Muscle layout. Mirror of tools/body_spec.json (angles in degrees, flex = positive direction).
export const BODY_SPEC = {
  axial: [
    { joint: 'spine', parent: 'pelvis', child: 'chest', dofs: { pitch: [-25, 40], yaw: [-35, 35], roll: [-25, 25] } },
    { joint: 'neck', parent: 'chest', child: 'head', dofs: { pitch: [-35, 45], yaw: [-70, 70] } },
  ],
  lateral: [
    { joint: 'hip', parent: 'pelvis', child: 'thigh', dofs: { pitch: [-30, 100], roll: [-15, 45], yaw: [-30, 30] } },
    { joint: 'knee', parent: 'thigh', child: 'calf', dofs: { pitch: [0, 140] } },
    { joint: 'ankle', parent: 'calf', child: 'foot', dofs: { pitch: [-40, 40] } },
    { joint: 'shoulder', parent: 'chest', child: 'upperarm', dofs: { pitch: [-60, 170], roll: [-80, 90], yaw: [-60, 60] } },
    { joint: 'elbow', parent: 'upperarm', child: 'lowerarm', dofs: { pitch: [0, 145] } },
  ],
};

// Physical meaning of each DOF: which joint-frame axis it rotates about and with which sign
// (joint frame = character frame at bind: +X = Leno's left, +Y = up, +Z = forward).
//   spine/neck pitch flex = bend forward, yaw flex = turn left, spine roll flex = lean left
//   hip/shoulder pitch flex = limb forward, roll flex = abduct (outward), hip yaw flex = toe out,
//   shoulder yaw flex = arm swings forward/inward; knee/elbow flex = bend; ankle flex = toes up.
// Rapier builds a generic joint's frame from its axis with orthonormal_basis(): for axis (1,0,0)
// the frame is X = world X, Y = world -Z, Z = world +Y. So pitch -> AngX, yaw -> AngZ, roll -> -AngY.
const PHYS_AXIS = { pitch: ['AngX', 1], yaw: ['AngZ', 1], roll: ['AngY', -1] };
const AX = { pitch: 0, yaw: 1, roll: 2 };               // component of the relative rotation (x, y, z)
const DOF_SIGN = {
  spine: { pitch: 1, yaw: 1, roll: -1 },
  neck: { pitch: 1, yaw: 1 },
  hip_l: { pitch: -1, roll: 1, yaw: 1 }, hip_r: { pitch: -1, roll: -1, yaw: -1 },
  shoulder_l: { pitch: -1, roll: 1, yaw: -1 }, shoulder_r: { pitch: -1, roll: -1, yaw: 1 },
  knee_l: { pitch: 1 }, knee_r: { pitch: 1 },
  ankle_l: { pitch: -1 }, ankle_r: { pitch: -1 },
  elbow_l: { pitch: 1 }, elbow_r: { pitch: 1 },
};

/** Flat list of DOFs: {key:'hip_l_pitch', joint:'hip_l', dof:'pitch', min, max} (degrees). */
export const MUSCLE_DOFS = [];
for (const j of BODY_SPEC.axial) for (const [dof, [min, max]] of Object.entries(j.dofs)) MUSCLE_DOFS.push({ key: `${j.joint}_${dof}`, joint: j.joint, dof, min, max });
for (const j of BODY_SPEC.lateral) for (const side of ['l', 'r']) for (const [dof, [min, max]] of Object.entries(j.dofs)) MUSCLE_DOFS.push({ key: `${j.joint}_${side}_${dof}`, joint: `${j.joint}_${side}`, dof, min, max });
/** The 46 muscle names, same naming as data/neurons.json "muscles". */
export const MUSCLE_NAMES = MUSCLE_DOFS.flatMap((d) => [d.key + '_flex', d.key + '_ext']);

export const MUSCLE_TUNING = {
  // joint strength S (N·m/rad at a_flex + a_ext = 1, for an 80 kg / 1.86 m body; x model scale)
  strength: { spine: 800, neck: 70, hip: 3500, knee: 2000, ankle: 1200, shoulder: 90, elbow: 45 },
  K_BASE: 0.02,        // stiffness fraction with no activation (limp)
  K_GAIN: 1.0,         // stiffness fraction per unit of (a_flex + a_ext)
  DAMP_RATIO: 0.04,    // damping = DAMP_RATIO * sqrt(scale) * stiffness  (N·m·s/rad)
  PASSIVE_DAMP: 0.4,   // N·m·s/rad, always on
};

// Puppet strings (setSupport). Gains are multiplied by the support level 0..1.
export const SUPPORT_TUNING = {
  chest: 0.88,         // share of the vertical string stiffness on the chest (top), rest on the head
  head: 0.12,
  sagPerWeight: 0.15,  // m of sag (x model scale) at which the strings carry the full body weight
  slack: 0.08,         // m (x scale) below standing height before the strings start pulling
  upright: 1.5,        // pelvis upright stiffness, in units of body weight x standing COM height (N·m/rad)
  uprightDamp: 0.3,    // pelvis upright damping, same units (N·m·s/rad)
  yawDamp: 0.2,        // pelvis yaw-rate damping (no yaw stiffness: heading stays free), same units
  center: 1.0,         // horizontal pull of the chest string toward the point above the feet, in W / chest height (N/m)
  centerDamp: 0.35,    // its damping time (s): c = center stiffness * centerDamp
  footFriction: 1.5,   // feet use the max of this and the ground friction (read at construction)
};

// Body masses (kg, ~81 kg total).
const MASS = { pelvis: 12, chest: 26, head: 5.5, upperarm: 2.3, lowerarm: 1.8, thigh: 9.5, calf: 4, foot: 1.2 };

// Collision groups (membership << 16 | filter). Body parts collide only with the ground: Leno's thick
// thighs overlap at bind, and leg-leg contact would glue the legs together.
const G_GROUND = 1, G_TORSO = 2, G_ARM = 4, G_LEG_L = 8, G_LEG_R = 16;
const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
const RAW_AXIS = { LinX: 0, LinY: 1, LinZ: 2, AngX: 3, AngY: 4, AngZ: 5 };
const MASK = { LinX: 1, LinY: 2, LinZ: 4, AngX: 8, AngY: 16, AngZ: 32 };
const FORCE_BASED = 1;
const MIN_DAMP = 1e-3;
const DEG = Math.PI / 180;

/** Load Rapier (pinned, from jsDelivr) and create a world with gravity -9.81 and 1/120 s steps. */
export async function initPhysics() {
  const mod = await import(/* @vite-ignore */ RAPIER_URL);
  const RAPIER = mod.init ? mod : mod.default;
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = FIXED_DT;
  return { RAPIER, world };
}

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v3 = new THREE.Vector3(), _q3 = new THREE.Quaternion(), _X = new THREE.Vector3(1, 0, 0);
const _qh = new THREE.Quaternion(), _qh2 = new THREE.Quaternion(), _vh = new THREE.Vector3();
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class RagdollLeno {
  constructor({ RAPIER, world, model, groundMeshes = [] }) {
    this.R = RAPIER;
    this.world = world;
    this.model = model;
    this.muscleNames = MUSCLE_NAMES.slice();
    this.act = Object.fromEntries(this.muscleNames.map((n) => [n, 0]));
    this.support = 0;
    this.accum = 0;
    this.stats = { stepMs: 0, substeps: 0, syncMs: 0 };
    this.placePos = new THREE.Vector3();
    this.placeYaw = 0;
    this.dirty = true;

    // ---- bind pose in "character space" (model rotation/translation removed, model scale kept)
    model.updateWorldMatrix(true, true);
    model.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
    const mPos = new THREE.Vector3(), mQuat = new THREE.Quaternion(), mScale = new THREE.Vector3();
    model.matrixWorld.decompose(mPos, mQuat, mScale);
    this.scale = mScale.x;                       // HOST_SCALE (uniform)
    const s = this.scale;
    const invChar = new THREE.Matrix4().compose(mPos, mQuat, new THREE.Vector3(1, 1, 1)).invert();
    const invQ = mQuat.clone().invert();
    const bone = (n) => {
      const b = model.getObjectByName(n);
      if (!b) throw new Error('RagdollLeno: bone not found: ' + n);
      return b;
    };
    const P = (n) => bone(n).getWorldPosition(new THREE.Vector3()).applyMatrix4(invChar);
    const Q = (n) => invQ.clone().multiply(bone(n).getWorldQuaternion(new THREE.Quaternion()));

    // ---- body geometry from bone positions
    const shapes = {};
    const seg = (a, b, r) => ({ kind: 'capsule', a, b, r });
    const pelvis = P('pelvis'), hipL = P('thigh_l'), hipR = P('thigh_r'), sp1 = P('spine_01'), neck = P('neck_01'), head = P('head');
    shapes.pelvis = { kind: 'capsule', a: new THREE.Vector3(hipL.x, (pelvis.y + hipL.y) / 2 + 0.01 * s, pelvis.z), b: new THREE.Vector3(hipR.x, (pelvis.y + hipR.y) / 2 + 0.01 * s, pelvis.z), r: 0.105 * s };
    const chestC = new THREE.Vector3(sp1.x, (sp1.y + neck.y) / 2 + 0.01 * s, (sp1.z + neck.z) / 2);
    shapes.chest = { kind: 'box', c: chestC, h: new THREE.Vector3(0.155 * s, (neck.y - sp1.y) / 2 - 0.005 * s, 0.105 * s) };
    const headTop = new THREE.Vector3(head.x, head.y + 0.18 * s, head.z + 0.015 * s);
    shapes.head = seg(new THREE.Vector3(neck.x, neck.y + 0.02 * s, neck.z + 0.01 * s), headTop, 0.1 * s);
    for (const x of ['l', 'r']) {
      shapes['upperarm_' + x] = seg(P('upperarm_' + x), P('lowerarm_' + x), 0.05 * s);
      shapes['lowerarm_' + x] = seg(P('lowerarm_' + x), P('middle_01_' + x), 0.042 * s);
      shapes['thigh_' + x] = seg(P('thigh_' + x), P('calf_' + x), 0.075 * s);
      shapes['calf_' + x] = seg(P('calf_' + x), P('foot_' + x), 0.055 * s);
      const f = P('foot_' + x), ball = P('ball_' + x);
      const heelZ = f.z - 0.075 * s, toeZ = ball.z + 0.085 * s, top = f.y - 0.01 * s;
      shapes['foot_' + x] = { kind: 'box', c: new THREE.Vector3((f.x + ball.x) / 2, top / 2, (heelZ + toeZ) / 2), h: new THREE.Vector3(0.052 * s, top / 2, (toeZ - heelZ) / 2) };
    }
    this.shapes = shapes;
    this.bodyNames = Object.keys(shapes);

    // ---- rigid bodies (identity orientation at bind; collider oriented along the bone)
    this.bodies = {};
    this.colliders = {};
    this.bindCenter = {};
    const massOf = (n) => MASS[n.replace(/_[lr]$/, '')];
    const groupOf = (n) => (/^(pelvis|chest|head)$/.test(n) ? groups(G_TORSO, G_GROUND)
      : /arm/.test(n) ? groups(G_ARM, G_GROUND)
        : n.endsWith('_l') ? groups(G_LEG_L, G_GROUND) : groups(G_LEG_R, G_GROUND));
    for (const n of this.bodyNames) {
      const sh = shapes[n];
      let c, cd;
      if (sh.kind === 'capsule') {
        c = sh.a.clone().add(sh.b).multiplyScalar(0.5);
        const len = sh.a.distanceTo(sh.b);
        cd = RAPIER.ColliderDesc.capsule(Math.max(0.01, len / 2 - sh.r * 0.5), sh.r);
        const dir = _v.copy(sh.b).sub(sh.a).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        cd.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
        sh.q = q; sh.hh = Math.max(0.01, len / 2 - sh.r * 0.5);
      } else {
        c = sh.c.clone();
        cd = RAPIER.ColliderDesc.cuboid(sh.h.x, sh.h.y, sh.h.z);
      }
      cd.setMass(massOf(n)).setFriction(n.startsWith('foot') ? SUPPORT_TUNING.footFriction : 0.6).setRestitution(0).setCollisionGroups(groupOf(n));
      if (n.startsWith('foot')) cd.setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
      const bd = RAPIER.RigidBodyDesc.dynamic().setTranslation(c.x, c.y, c.z).setCanSleep(false)
        .setLinearDamping(0.02).setAngularDamping(0.3);
      const body = world.createRigidBody(bd);
      this.colliders[n] = world.createCollider(cd, body);
      this.bodies[n] = body;
      this.bindCenter[n] = c;
    }
    this.totalMass = this.bodyNames.reduce((a, n) => a + massOf(n), 0);

    // ---- joints (generic joints, identity frames = character axes; hinges use their axis)
    this.joints = {};
    this.dofs = [];
    const armAxis = (x) => {
      const d = P('middle_01_' + x).sub(P('lowerarm_' + x)).normalize();
      return d.cross(new THREE.Vector3(0, 0, 1)).normalize();      // flex swings the forearm forward/up
    };
    const jdefs = [
      { name: 'spine', parent: 'pelvis', child: 'chest', at: sp1, free: ['AngX', 'AngY', 'AngZ'] },
      { name: 'neck', parent: 'chest', child: 'head', at: neck, free: ['AngX', 'AngZ'] }   // pitch + yaw (roll locked),
    ];
    for (const x of ['l', 'r']) {
      jdefs.push(
        { name: 'hip_' + x, parent: 'pelvis', child: 'thigh_' + x, at: P('thigh_' + x), free: ['AngX', 'AngY', 'AngZ'] },
        { name: 'knee_' + x, parent: 'thigh_' + x, child: 'calf_' + x, at: P('calf_' + x), free: ['AngX'], axis: new THREE.Vector3(1, 0, 0) },
        { name: 'ankle_' + x, parent: 'calf_' + x, child: 'foot_' + x, at: P('foot_' + x), free: ['AngX'], axis: new THREE.Vector3(1, 0, 0) },
        { name: 'shoulder_' + x, parent: 'chest', child: 'upperarm_' + x, at: P('upperarm_' + x), free: ['AngX', 'AngY', 'AngZ'] },
        { name: 'elbow_' + x, parent: 'upperarm_' + x, child: 'lowerarm_' + x, at: P('lowerarm_' + x), free: ['AngX'], axis: armAxis(x) },
      );
    }
    const allMask = 63;
    for (const jd of jdefs) {
      const a1 = jd.at.clone().sub(this.bindCenter[jd.parent]);
      const a2 = jd.at.clone().sub(this.bindCenter[jd.child]);
      const axis = jd.axis ?? new THREE.Vector3(1, 0, 0);
      let locked = allMask;
      for (const f of jd.free) locked &= ~MASK[f];
      const data = RAPIER.JointData.generic(a1, a2, { x: axis.x, y: axis.y, z: axis.z }, locked);
      const joint = world.createImpulseJoint(data, this.bodies[jd.parent], this.bodies[jd.child], true);
      joint.setContactsEnabled(false);
      const base = jd.name.replace(/_[lr]$/, '');
      const j = { ...jd, joint, handle: joint.handle, base, axis: axis.clone() };
      this.joints[jd.name] = j;
    }
    // DOF table (+ limits + force-based motors)
    const raw = world.impulseJoints.raw;
    for (const d of MUSCLE_DOFS) {
      const j = this.joints[d.joint];
      const hinge = j.free.length === 1;
      const [axisName, physSign] = hinge ? ['AngX', 1] : PHYS_AXIS[d.dof];
      const physDofSign = DOF_SIGN[d.joint][d.dof];          // DOF -> rotation about the world-aligned axis
      const sign = physDofSign * physSign;                    // DOF -> Rapier frame axis
      const rawAxis = RAW_AXIS[axisName];
      const lo = (sign > 0 ? d.min : -d.max) * DEG, hi = (sign > 0 ? d.max : -d.min) * DEG;
      raw.jointSetLimits(j.handle, rawAxis, lo, hi);
      raw.jointConfigureMotorModel(j.handle, rawAxis, FORCE_BASED);
      this.dofs.push({ ...d, j, sign, physDofSign, rawAxis, flex: d.key + '_flex', ext: d.key + '_ext', target: 0, k: 0 });
    }

    // ---- puppet strings. Vertical strings on the chest (top) and head are explicit pull-only
    // spring-dampers (soft enough for 120 Hz). The pelvis upright torque is stiff, so it is an implicit
    // joint motor to a kinematic anchor that follows the pelvis position and heading.
    const chestTop = new THREE.Vector3(0, shapes.chest.h.y, 0);          // chest local
    this.strings = {
      chest: { target: 'chest', local: chestTop, bindY: chestC.y + chestTop.y, share: 'chest', groundY: 0 },
      head: { target: 'head', local: new THREE.Vector3(), bindY: this.bindCenter.head.y, share: 'head', groundY: 0 },
    };
    this.uprightAnchor = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    // frame of a generic joint with axis (1,0,0): AngX = world X, AngY = world -Z (tilt axes)
    this.uprightJoint = world.createImpulseJoint(RAPIER.JointData.generic({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0), this.uprightAnchor, this.bodies.pelvis, true);
    this.uprightJoint.setContactsEnabled(false);
    raw.jointConfigureMotorModel(this.uprightJoint.handle, RAW_AXIS.AngX, FORCE_BASED);
    raw.jointConfigureMotorModel(this.uprightJoint.handle, RAW_AXIS.AngY, FORCE_BASED);
    raw.jointConfigureMotorModel(this.uprightJoint.handle, RAW_AXIS.AngZ, FORCE_BASED);   // AngZ = world up (yaw)

    // ---- skin binding: bone world = body world * offset (captured at bind)
    const drive = [['pelvis', 'pelvis'], ['spine_01', 'chest'], ['neck_01', 'head']];
    for (const x of ['l', 'r']) drive.push(['upperarm_' + x, 'upperarm_' + x], ['lowerarm_' + x, 'lowerarm_' + x], ['thigh_' + x, 'thigh_' + x], ['calf_' + x, 'calf_' + x], ['foot_' + x, 'foot_' + x]);
    this.drive = drive.map(([bn, body]) => ({ bone: bone(bn), body: this.bodies[body], offP: P(bn).sub(this.bindCenter[body]), offQ: Q(bn) }));
    // parent-first order
    const depth = (o) => { let d = 0; while (o.parent) { d++; o = o.parent; } return d; };
    this.drive.sort((a, b) => depth(a.bone) - depth(b.bone));

    // marker offsets (body local)
    this.mouthLocal = head.clone().add(new THREE.Vector3(0, -0.035 * s, 0.12 * s)).sub(this.bindCenter.head);
    this.headLocal = head.clone().add(new THREE.Vector3(0, 0.07 * s, 0.03 * s)).sub(this.bindCenter.head);
    // between the eyes, a little inside the face (first-person camera)
    this.eyeLocal = head.clone().add(new THREE.Vector3(0, 0.04 * s, 0.075 * s)).sub(this.bindCenter.head);
    this.buttLocal = new THREE.Vector3(pelvis.x, pelvis.y - 0.13 * s, pelvis.z - 0.13 * s).sub(this.bindCenter.pelvis);
    this.pelvisBindY = this.bindCenter.pelvis.y;

    // ---- ground
    this.ground = null;
    this.setGround(groundMeshes);
    this.place(new THREE.Vector3(mPos.x, mPos.y, mPos.z), new THREE.Euler().setFromQuaternion(mQuat, 'YXZ').y);
  }

  /** (Re)build the fixed trimesh ground collider from THREE meshes (world transforms baked in). */
  setGround(groundMeshes) {
    const R = this.R;
    if (this.ground) { this.world.removeCollider(this.ground, false); this.ground = null; }
    const verts = [], idx = [];
    const v = new THREE.Vector3();
    for (const root of groundMeshes) {
      root.updateWorldMatrix(true, true);
      root.traverse((m) => {
        if (!m.isMesh || !m.geometry?.attributes?.position) return;
        const pos = m.geometry.attributes.position, base = verts.length / 3;
        for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); verts.push(v.x, v.y, v.z); }
        const index = m.geometry.index;
        if (index) for (let i = 0; i < index.count; i++) idx.push(base + index.getX(i));
        else for (let i = 0; i < pos.count; i++) idx.push(base + i);
      });
    }
    if (!idx.length) return;
    const V = new Float32Array(verts), I = new Uint32Array(idx);
    let desc = null;
    try {
      desc = R.TriMeshFlags ? R.ColliderDesc.trimesh(V, I, R.TriMeshFlags.FIX_INTERNAL_EDGES) : null;
      if (desc) this.ground = this.world.createCollider(desc.setFriction(1.0).setCollisionGroups(groups(G_GROUND, 0xffff)));
    } catch (e) { this.ground = null; }
    if (!this.ground) {
      desc = R.ColliderDesc.trimesh(V, I);
      this.ground = this.world.createCollider(desc.setFriction(1.0).setCollisionGroups(groups(G_GROUND, 0xffff)));
    }
  }

  /** Stand Leno upright at `position` (on the ground surface), facing `yaw` (rad, 0 = +Z). */
  place(position, yaw = 0) {
    this.placePos.copy(position);
    this.placeYaw = yaw;
    this.reset();
  }

  reset() {
    const q = _q.setFromAxisAngle(UP, this.placeYaw);
    const rq = { x: q.x, y: q.y, z: q.z, w: q.w };
    for (const n of this.bodyNames) {
      const p = _v.copy(this.bindCenter[n]).applyQuaternion(q).add(this.placePos);
      p.y += 0.01 * this.scale;
      const b = this.bodies[n];
      b.setTranslation({ x: p.x, y: p.y, z: p.z }, true);
      b.setRotation(rq, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
      b.resetForces(true); b.resetTorques(true);
    }
    this.accum = 0;
    this.updateGroundUnderStrings(true);
    this.updateStrings(0);
    this.dirty = true;
  }

  setActivations(obj = {}) {
    for (const n of this.muscleNames) {
      const a = obj[n];
      this.act[n] = a > 0 ? (a < 1 ? a : 1) : 0;   // also maps NaN/undefined to 0
    }
    this.dirty = true;
  }

  setSupport(s) {
    this.support = Math.max(0, Math.min(1, +s || 0));
    this.dirty = true;
  }

  // push activations -> motor targets / gains
  applyMuscles() {
    const raw = this.world.impulseJoints.raw, T = MUSCLE_TUNING, sc = this.scale, dsc = Math.sqrt(sc);
    for (const d of this.dofs) {
      const af = this.act[d.flex], ae = this.act[d.ext];
      const u = af - ae;
      const deg = u >= 0 ? u * d.max : -u * d.min;           // rest = 0
      const k = T.strength[d.j.base] * sc * (T.K_BASE + T.K_GAIN * (af + ae));
      const c = T.DAMP_RATIO * dsc * k + T.PASSIVE_DAMP + MIN_DAMP;
      d.target = deg; d.k = k;
      raw.jointConfigureMotor(d.j.handle, d.rawAxis, d.sign * deg * DEG, 0, k, c);
    }
    // strings
    const S = SUPPORT_TUNING, W = this.totalMass * 9.81, s = this.support, h = this.pelvisBindY + 0.2 * sc;
    this.kLin = s * W / (S.sagPerWeight * sc);
    this.cLin = s * 0.1 * W * dsc;
    const kUp = s * S.upright * W * h, cUp = s * S.uprightDamp * W * h;
    // NB: a Rapier motor with stiffness = damping = 0 is a rigid lock (zero softness), not "off",
    // so every motor keeps a tiny minimum damping.
    raw.jointConfigureMotor(this.uprightJoint.handle, RAW_AXIS.AngX, 0, 0, kUp, cUp + MIN_DAMP);
    raw.jointConfigureMotor(this.uprightJoint.handle, RAW_AXIS.AngY, 0, 0, kUp, cUp + MIN_DAMP);
    raw.jointConfigureMotor(this.uprightJoint.handle, RAW_AXIS.AngZ, 0, 0, 0, s * S.yawDamp * W * h + MIN_DAMP);
    this.dirty = false;
  }

  groundHeightAt(x, z, fromY) {
    if (!this.ground) return null;
    const ray = this._ray ??= new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    ray.origin.x = x; ray.origin.y = fromY; ray.origin.z = z;
    const toi = this.ground.castRay(ray, 50, true);
    return toi === null || toi < 0 ? null : fromY - toi;
  }

  updateGroundUnderStrings(force) {
    for (const st of Object.values(this.strings)) {
      const t = this.bodies[st.target].translation();
      const g = this.groundHeightAt(t.x, t.z, t.y + 0.2 * this.scale);
      if (g !== null) st.groundY = force ? g : st.groundY + (g - st.groundY) * 0.2;
      else if (force) st.groundY = this.placePos.y;
    }
  }

  // strings: pull-only vertical spring-dampers toward standing height; move the upright anchor
  // (teleported each substep to the pelvis position and heading, so its motors only see tilt and yaw rate)
  /** posture of the puppet strings: drop (0..1 of standing height), lean (m forward of the feet), pitch (rad, pelvis forward) */
  setStance(drop = 0, lean = 0, pitch = 0, headFree = 0) { this.stance = { drop, lean, pitch, headFree }; }

  updateStrings(dt) {
    const S = SUPPORT_TUNING, sag = S.slack * this.scale;
    const stance = this.stance || { drop: 0, lean: 0, pitch: 0 };
    if (this.support > 0 && dt > 0) {
      const W = this.totalMass * 9.81;
      for (const st of Object.values(this.strings)) {
        const b = this.bodies[st.target];
        const t = b.translation(), r = b.rotation(), lv = b.linvel(), av = b.angvel();
        _q.set(r.x, r.y, r.z, r.w);
        const arm = _v.copy(st.local).applyQuaternion(_q);
        const vy = lv.y + (av.z * arm.x - av.x * arm.z);      // (w x r).y
        const py = t.y + arm.y;
        const share = S[st.share];
        const free = st.target === 'head' ? stance.headFree || 0 : 0;        // (the head string can let go: eating, sleeping)
        const f = share * (1 - free) * (this.kLin * (st.groundY + st.bindY * (1 - stance.drop) - sag - py) - this.cLin * vy);
        let fx = 0, fz = 0;
        if (st.target === 'chest' && S.center > 0) {
          // the puppeteer holds the control bar above the feet: horizontal spring toward the feet midpoint
          const fl = this.bodies.foot_l.translation(), fr = this.bodies.foot_r.translation();
          const kh = this.support * S.center * W / (st.bindY), ch = kh * S.centerDamp;
          const vx = lv.x + (av.y * arm.z - av.z * arm.y), vz = lv.z + (av.x * arm.y - av.y * arm.x);
          const pr = this.bodies.pelvis.rotation(); _v3.set(0, 0, 1).applyQuaternion(_q2.set(pr.x, pr.y, pr.z, pr.w)).setY(0).normalize();
          fx = kh * ((fl.x + fr.x) / 2 + _v3.x * stance.lean - (t.x + arm.x)) - ch * vx;
          fz = kh * ((fl.z + fr.z) / 2 + _v3.z * stance.lean - (t.z + arm.z)) - ch * vz;
          const fh = Math.hypot(fx, fz), lim = 0.5 * W;
          if (fh > lim) { fx *= lim / fh; fz *= lim / fh; }
        }
        const fy = f > 0 ? Math.min(f, 2 * W) : 0;
        if (fy || fx || fz) b.applyImpulseAtPoint({ x: fx * dt, y: fy * dt, z: fz * dt }, { x: t.x + arm.x, y: py, z: t.z + arm.z }, true);
      }
    }
    const pb = this.bodies.pelvis, t = pb.translation();
    _q2.setFromAxisAngle(UP, this.pelvisHeading(stance.pitch));
    if (stance.pitch) _q2.multiply(_q3.setFromAxisAngle(_X, stance.pitch));        // lean the pelvis forward
    this.uprightAnchor.setTranslation(t, true);
    this.uprightAnchor.setRotation({ x: _q2.x, y: _q2.y, z: _q2.z, w: _q2.w }, true);
  }

  /** Advance physics by dt seconds (fixed 1/120 s substeps, at most 8 per call). */
  step(dt) {
    const t0 = performance.now();
    if (this.dirty) this.applyMuscles();
    this.accum = Math.min(this.accum + Math.max(0, dt), 8 * FIXED_DT);
    let n = 0;
    if (this.accum >= FIXED_DT) this.updateGroundUnderStrings(false);
    while (this.accum >= FIXED_DT) {
      this.updateStrings(FIXED_DT);
      this.world.step();
      this.accum -= FIXED_DT;
      n++;
    }
    const ms = performance.now() - t0;
    this.stats.substeps = n;
    this.stats.stepMs += (ms - this.stats.stepMs) * 0.05;
    this.stats.lastStepMs = ms;
  }

  /** Copy body transforms onto the skinned bones (bone world = body world * bind offset). */
  syncSkin() {
    const t0 = performance.now();
    const sc = _s.set(this.scale, this.scale, this.scale);
    for (const d of this.drive) {
      const t = d.body.translation(), r = d.body.rotation();
      _q.set(r.x, r.y, r.z, r.w);
      _v.copy(d.offP).applyQuaternion(_q).add(t);
      _q2.copy(_q).multiply(d.offQ);
      _m.compose(_v, _q2, sc);
      const bone = d.bone;
      bone.parent.updateWorldMatrix(true, false);
      _m2.copy(bone.parent.matrixWorld).invert().multiply(_m);
      _m2.decompose(bone.position, bone.quaternion, bone.scale);
      bone.matrix.copy(_m2);
      bone.matrixWorld.copy(_m);
    }
    this.model.updateMatrixWorld(true);
    if (this.debugGroup?.visible) this.syncDebug();
    this.stats.syncMs = performance.now() - t0;
  }

  bodyPoint(name, local, out = new THREE.Vector3()) {
    const b = this.bodies[name], t = b.translation(), r = b.rotation();
    return out.copy(local).applyQuaternion(_q.set(r.x, r.y, r.z, r.w)).add(t);
  }

  /** which way the pelvis faces (yaw), measured with the posture's own forward tilt taken out: when the strings
   *  tip him forward (eating, sleeping) the pelvis points nearly straight down, and its raw forward direction would
   *  swing wildly with every wobble (and the strings, following it, would spin him round) */
  pelvisHeading(pitch = 0) {
    const r = this.bodies.pelvis.rotation();
    _qh.set(r.x, r.y, r.z, r.w);
    if (pitch) _qh.multiply(_qh2.setFromAxisAngle(_X, -pitch));
    const f = _vh.set(0, 0, 1).applyQuaternion(_qh);
    return Math.atan2(f.x, f.z);
  }

  getState() {
    const pel = this.bodies.pelvis.translation(), chestR = this.bodies.chest.rotation(), pelR = this.bodies.pelvis.rotation();
    const g = this.groundHeightAt(pel.x, pel.z, pel.y + 0.1 * this.scale) ?? Math.min(this.bodies.foot_l.translation().y, this.bodies.foot_r.translation().y) - 0.035 * this.scale;
    const heading = this.pelvisHeading(this.stance?.pitch || 0);
    const up = _v2.set(0, 1, 0).applyQuaternion(_q.set(chestR.x, chestR.y, chestR.z, chestR.w));
    const upright = Math.max(0, up.y);
    const pelvisH = pel.y - g;
    const fallen = pelvisH < 0.55 * this.pelvisBindY || upright < 0.45;
    return {
      root: new THREE.Vector3(pel.x, g, pel.z),
      heading, upright, fallen, pelvisHeight: pelvisH, yawRate: this.bodies.pelvis.angvel().y,
      feetContact: { l: this.footContact('foot_l'), r: this.footContact('foot_r') },
      headPos: this.bodyPoint('head', this.headLocal),
      mouthPos: this.bodyPoint('head', this.mouthLocal),
      buttPos: this.bodyPoint('pelvis', this.buttLocal),
    };
  }

  footContact(name) {
    if (!this.ground) return false;
    let hit = false;
    this.world.contactPair(this.colliders[name], this.ground, (m) => {
      for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.02 * this.scale) { hit = true; break; }
    });
    return hit;
  }

  /** Current joint angles in degrees, in muscle-DOF convention (flex = positive). */
  getJointAngles() {
    const out = {};
    for (const d of this.dofs) {
      const j = d.j;
      const r1 = j.joint.body1().rotation(), r2 = j.joint.body2().rotation();
      _q.set(r1.x, r1.y, r1.z, r1.w).invert().multiply(_q2.set(r2.x, r2.y, r2.z, r2.w));
      if (_q.w < 0) { _q.x = -_q.x; _q.y = -_q.y; _q.z = -_q.z; _q.w = -_q.w; }
      let comp;
      if (j.free.length === 1) comp = _q.x * j.axis.x + _q.y * j.axis.y + _q.z * j.axis.z;
      else comp = [_q.x, _q.y, _q.z][AX[d.dof]];
      out[d.key] = d.physDofSign * 2 * Math.asin(Math.max(-1, Math.min(1, comp))) / DEG;
    }
    return out;
  }

  applyImpulse(bodyName, vec) {
    const b = this.bodies[bodyName];
    if (b) b.applyImpulse({ x: vec.x, y: vec.y, z: vec.z }, true);
  }

  /** first-person eye pose: { pos, quat } (the head body's frame looks along its local +Z) */
  eyePose(pos = new THREE.Vector3(), quat = new THREE.Quaternion()) {
    this.bodyPoint('head', this.eyeLocal, pos);
    const r = this.bodies.head.rotation(); quat.set(r.x, r.y, r.z, r.w);
    return { pos, quat };
  }

  applyTorqueImpulse(bodyName, vec) {
    const b = this.bodies[bodyName];
    if (b) b.applyTorqueImpulse({ x: vec.x, y: vec.y, z: vec.z }, true);
  }

  /** Optional wireframe view of the collision shapes (add the returned group to the scene). */
  makeDebugGroup() {
    const g = new THREE.Group();
    g.name = 'RagdollDebug';
    const mat = new THREE.MeshBasicMaterial({ color: 0x33ff99, wireframe: true, transparent: true, opacity: 0.5 });
    this.debugMeshes = {};
    for (const n of this.bodyNames) {
      const sh = this.shapes[n];
      let geo, inner = new THREE.Object3D();
      if (sh.kind === 'capsule') { geo = new THREE.CapsuleGeometry(sh.r, sh.hh * 2, 3, 8); inner.quaternion.copy(sh.q); }
      else geo = new THREE.BoxGeometry(sh.h.x * 2, sh.h.y * 2, sh.h.z * 2);
      const mesh = new THREE.Mesh(geo, mat);
      inner.add(mesh);
      const holder = new THREE.Group();
      holder.add(inner);
      g.add(holder);
      this.debugMeshes[n] = holder;
    }
    this.debugGroup = g;
    this.syncDebug();
    return g;
  }

  syncDebug() {
    for (const n of this.bodyNames) {
      const b = this.bodies[n], t = b.translation(), r = b.rotation(), h = this.debugMeshes[n];
      h.position.set(t.x, t.y, t.z); h.quaternion.set(r.x, r.y, r.z, r.w);
    }
  }

  dispose() {
    this.world.removeRigidBody(this.uprightAnchor);
    for (const n of this.bodyNames) this.world.removeRigidBody(this.bodies[n]);
    if (this.ground) this.world.removeCollider(this.ground, false);
    this._ray?.free?.();
    this.bodies = {}; this.bodyNames = []; this.ground = null;
    this.debugGroup?.removeFromParent();
  }
}
