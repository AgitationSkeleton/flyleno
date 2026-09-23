// "Fly-Leno": a giant Drosophila body with Grey Leno's head, driven by the same fly brain.
//
//   walking  - alternating-tripod gait (L1,R2,L3 / R1,L2,R3); speed from the walking DNs (P9/oDN1),
//              turning from DNa01/02, backing up from MDN
//   flight   - wing power from DNg02/DNp13 (the fly's flight-power / song descending neurons); a giant-fiber
//              volley (DNp01) makes an escape jump into flight; when wing power fades he lands
//   feeding  - crouches and lowers Leno's face to the food (MN9 / eat posture)
//   grooming - front legs rub each other (mild) or sweep over the head (strong aDN activity)
// It shares the Rapier world with the ragdoll (kinematic character controller + kinematic colliders), so
// thrown tomatoes and pipes hit it, and it offers the same interface as js/body.js (PhysicsLeno).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { keep } from './dispose.js';

const S = 1.0;                                  // body scale (thorax ~0.55 m wide)
const DT = 1 / 120;
const G_GROUND = 1;
const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const UP = new THREE.Vector3(0, 1, 0);

function bandedAbdomen() {
  const g = new THREE.SphereGeometry(0.34 * S, 16, 12);
  g.scale(1, 0.85, 1.55);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const light = new THREE.Color(0xb9874a), dark = new THREE.Color(0x3a2616);
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i) / (0.34 * 1.55 * S);           // -1 (tip) .. 1 (front)
    const seg = ((1 - z) * 3.2) % 1;                     // tergite bands, dark at the rear of each segment
    const top = pos.getY(i) > -0.05;                     // pale underside
    const c = top && seg > 0.55 ? dark : light;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function wingTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(210,225,235,0.35)';
  x.beginPath(); x.ellipse(128, 64, 124, 58, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = 'rgba(60,45,30,0.85)'; x.lineWidth = 2.2;
  // longitudinal veins (L1-L5) and two cross veins, like a Drosophila wing
  for (const [y0, y1] of [[58, 30], [62, 44], [64, 62], [66, 82], [70, 100]]) { x.beginPath(); x.moveTo(6, y0); x.quadraticCurveTo(140, (y0 + y1) / 2, 246, y1); x.stroke(); }
  x.beginPath(); x.moveTo(120, 50); x.lineTo(124, 68); x.stroke();
  x.beginPath(); x.moveTo(170, 66); x.lineTo(166, 88); x.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let headGltf = null;                            // the head model is downloaded once and cloned

export class FlyLeno {
  /** opts.scale: overall size (1 = host; hatchlings smaller); opts.mini: no physics (ground by ray cast on opts.ground) */
  constructor(scene, opts = {}) {
    this.scene = scene; this.isFly = true;
    this.k = opts.scale ?? 1; this.mini = !!opts.mini; this.groundMeshes = opts.ground || [];
    this.ray = new THREE.Raycaster();
    this.root = new THREE.Group(); this.root.name = 'FlyLeno';
    this.cmd = { forward: 0, backward: 0, turn: 0, startle: 0, groom: 0, feed: 0 };
    this.rates = {};
    this.posture = { eat: 0, rub: 0 }; this.postureTarget = { eat: 0, rub: 0 };
    this.heading = 0; this.yawRate = 0; this.speed = 0;
    this.vel = new THREE.Vector3();
    this.flying = false; this.flyT = 0; this.power = 0; this.quietT = 0; this.knockT = 0; this.tumble = null;
    this.phase = 0; this.t = 0;
    this.gesture = null;
    this.state = { root: new THREE.Vector3(), heading: 0, upright: 1, fallen: false, headPos: new THREE.Vector3(), mouthPos: new THREE.Vector3(), buttPos: new THREE.Vector3(), yawRate: 0 };
  }

  async load(headUrl = 'assets/grey_leno_head.glb') {
    const mat = (hex, extra = {}) => new THREE.MeshStandardMaterial({ color: hex, roughness: 0.55, ...extra });
    const cuticle = mat(0xa8763e, { roughness: 0.45 });
    const legMat = mat(0x5b3a1f, { roughness: 0.6 });
    this.body = new THREE.Group(); this.root.add(this.body);
    // thorax (with a darker scutum on top) and abdomen
    const thorax = new THREE.Mesh(new THREE.SphereGeometry(0.3 * S, 18, 14).scale(0.95, 0.88, 1.2), cuticle);
    thorax.position.set(0, 0.95 * S, 0.1 * S);
    const scutum = new THREE.Mesh(new THREE.SphereGeometry(0.27 * S, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.4).scale(0.95, 0.9, 1.15), mat(0x7a5226));
    scutum.position.set(0, 0.99 * S, 0.1 * S);
    const abdomen = new THREE.Mesh(bandedAbdomen(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }));
    abdomen.position.set(0, 0.9 * S, -0.55 * S); abdomen.rotation.x = 0.18;
    this.abdomen = abdomen;
    this.body.add(thorax, scutum, abdomen);
    // head: Leno's, on a short neck, plus antennae with feathery aristae
    headGltf ||= new GLTFLoader().loadAsync(headUrl);
    const gltf = await headGltf;
    keep(gltf.scene);                                  // every Fly-Leno (and fly hatchling) clones the same head
    this.head = new THREE.Group();
    this.head.position.set(0, 1.08 * S, 0.42 * S);
    const hm = gltf.scene.clone(true); hm.scale.setScalar(1.9); hm.position.set(0, -0.05, 0);
    this.head.add(hm);
    this.morphs = [];
    hm.traverse((o) => { if (o.isMesh) { o.castShadow = true; const i = o.morphTargetDictionary?.MouthOpen; if (i !== undefined) this.morphs.push([o, i]); } });
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.1 * S, 0.14 * S, 0.22 * S, 10).rotateX(Math.PI / 2), cuticle);
    neck.position.set(0, 1.0 * S, 0.3 * S);
    this.body.add(neck, this.head);
    // Landmarks on Leno's head (from the face render, metres relative to the head bone, +Z forward), scaled
    // like the head model: brow between the eyes, and the lip line.
    const HS = 1.9, HY = -0.05;
    const L = (x, y, z) => new THREE.Vector3(x * HS, y * HS + HY, z * HS);
    // antennae, rigged to the head: each is anchored on the actual face surface of Leno's brow (found by a ray
    // cast onto the head mesh) and built from segments between explicit points in head space, so they sit on
    // the face and point the way a fly's do: scape out/up from the brow, the bulbous 3rd segment hanging down in
    // front of the face, the feathery arista angled outward and forward.
    const antMat = mat(0x6b4526, { roughness: 0.5 });
    this.root.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const headMeshes = []; hm.traverse((o) => { if (o.isMesh) headMeshes.push(o); });
    const surface = (x, y) => {
      const from = this.head.localToWorld(L(x, y, 0.4)), to = this.head.localToWorld(L(x, y, -0.1));
      ray.set(from, to.clone().sub(from).normalize());
      const hit = ray.intersectObjects(headMeshes, false)[0];
      return hit ? this.head.worldToLocal(hit.point.clone()) : L(x, y, 0.085);
    };
    const seg = (p0, p1, r0, r1, m = antMat) => {
      const d = p1.clone().sub(p0), g = new THREE.CylinderGeometry(r1, r0, d.length(), 7);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
      g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
      return new THREE.Mesh(g, m);
    };
    this.antennae = [-1, 1].map((s) => {
      const base = surface(0.026 * s, 0.07);                    // forehead, above and between the eyes
      const g = new THREE.Group(); g.position.copy(base);         // pivot at the socket (for twitching)
      const P = (x, y, z) => new THREE.Vector3(x * s, y, z);       // head space, relative to the socket
      // short thick scape + pedicel out of the socket, then the 3rd segment hangs down close to the face
      const scapeEnd = P(0.01, 0.0, 0.035), pedEnd = P(0.018, -0.018, 0.055), funEnd = P(0.022, -0.12, 0.06);
      g.add(new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), antMat));   // socket
      g.add(seg(P(0, 0, -0.01), scapeEnd, 0.024, 0.02));                        // scape
      g.add(seg(scapeEnd, pedEnd, 0.03, 0.026));                                // pedicel
      const fun = new THREE.Mesh(new THREE.SphereGeometry(0.036, 9, 7).scale(0.85, 1.6, 0.85), mat(0x8a5a30));
      fun.position.copy(pedEnd.clone().lerp(funEnd, 0.5));
      fun.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), funEnd.clone().sub(pedEnd).normalize());
      g.add(fun);                                                              // funiculus (3rd segment)
      const arBase = pedEnd.clone().lerp(funEnd, 0.3).add(P(0.02, 0, 0.01)), arEnd = arBase.clone().add(P(0.17, 0.06, 0.1));
      g.add(seg(arBase, arEnd, 0.006, 0.003));                                 // arista
      const dir = arEnd.clone().sub(arBase);
      for (let k = 1; k <= 6; k++) {                                           // feathery branches
        const q = arBase.clone().addScaledVector(dir, k / 7.5);
        const len = 0.05 - k * 0.005;
        g.add(seg(q, q.clone().add(new THREE.Vector3(0, len, 0.01)), 0.002, 0.0015));
        g.add(seg(q, q.clone().add(new THREE.Vector3(0, -len, 0.01)), 0.002, 0.0015));
      }
      this.head.add(g);
      return { g, side: s };
    });
    // no proboscis mesh: the mouth for feeding/vomiting is Leno's lip line
    this.mouthLocal = surface(0, -0.08).add(new THREE.Vector3(0, 0, 0.03));
    // wings (at rest folded back over the abdomen) and halteres
    const wmat = new THREE.MeshStandardMaterial({ map: wingTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 0.2, metalness: 0.1 });
    this.wings = [-1, 1].map((s) => {
      const hinge = new THREE.Group(); hinge.position.set(0.16 * s * S, 1.13 * S, 0.05 * S);
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1 * S, 0.5 * S).translate(0.55 * S * s, 0, 0).rotateX(-Math.PI / 2), wmat);
      hinge.add(w); this.body.add(hinge); hinge.side = s; return hinge;
    });
    this.halteres = [-1, 1].map((s) => {
      const h = new THREE.Group(); h.position.set(0.17 * s * S, 1.02 * S, -0.13 * S);
      h.add(new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.12, 4).translate(0, 0.06, 0), legMat));
      const k = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat(0xd9c8a0)); k.position.y = 0.12; h.add(k);
      this.body.add(h); return h;
    });
    // legs: six, each coxa->femur->tibia->tarsus, placed with two-bone IK every frame
    this.legs = [];
    const mk = (r0, r1) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 7), legMat);
    const hips = [[0.2, 0.32], [0.23, 0.08], [0.22, -0.14]];      // (x, z) on the thorax, front to hind
    const feet = [[0.62, 0.95], [0.85, 0.05], [0.72, -0.75]];     // resting foot (x, z)
    for (let pair = 0; pair < 3; pair++) for (const s of [1, -1]) {
      const leg = {
        side: s, pair, hip: new THREE.Vector3(hips[pair][0] * s * S, 0.82 * S, hips[pair][1] * S),
        rest: new THREE.Vector3(feet[pair][0] * s * S, 0, feet[pair][1] * S),
        femur: mk(0.045, 0.04), tibia: mk(0.035, 0.028), tarsus: mk(0.022, 0.016),
        foot: new THREE.Vector3(), plantedAt: new THREE.Vector3(), swing: 0,
        group: (pair === 0 && s === 1) || (pair === 1 && s === -1) || (pair === 2 && s === 1) ? 0 : 1,
      };
      this.root.add(leg.femur, leg.tibia, leg.tarsus);   // world-space placed
      this.legs.push(leg);
    }
    this.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.root.scale.setScalar(this.k);
    this.scene.add(this.root);
    return this;
  }

  /** attach to the shared Rapier world (from PhysicsLeno) */
  attach(physicsHost, stage) {
    const R = this.RAPIER = physicsHost.RAPIER;
    this.world = physicsHost.world;
    this.stageCenter = physicsHost.stageCenter; this.stageRadius = physicsHost.stageRadius;
    this.keepOnStage = physicsHost.keepOnStage;
    this.home = physicsHost.home.clone();
    // kinematic body origin = ground under the fly; a small ball at the feet moves with the character
    // controller, the body capsule (thorax + abdomen) is what thrown things hit
    this.kbody = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(this.home.x, this.home.y, this.home.z));
    this.collider = this.world.createCollider(R.ColliderDesc.ball(0.32 * S).setTranslation(0, 0.32 * S, 0)
      .setCollisionGroups(groups(G_GROUND, 0xffff)), this.kbody);
    this.bodyCollider = this.world.createCollider(R.ColliderDesc.capsule(0.42 * S, 0.34 * S).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 })
      .setTranslation(0, 0.93 * S, -0.15 * S).setCollisionGroups(groups(G_GROUND, 0xffff)), this.kbody);
    this.hbody = this.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased());
    this.world.createCollider(R.ColliderDesc.ball(0.3).setCollisionGroups(groups(G_GROUND, 0xffff)), this.hbody);
    this.ctrl = this.world.createCharacterController(0.03);
    this.ctrl.enableAutostep(0.5, 0.25, true);
    this.ctrl.enableSnapToGround(0.6);
    this.ctrl.setMaxSlopeClimbAngle(0.9);
    this.accum = 0;
    this.pos = this.home.clone();              // position of the thorax centre, projected to the ground (y = ground)
    this.bodyY = 0;                            // height of the body above the ground (flight/jump)
    this.rag = { bodies: { thorax: this.kbody, head: this.hbody }, getState: () => this.state };
    this.place(this.home, 0);
    return this;
  }

  // ---- host interface ----------------------------------------------------------------------------
  get position() { return this.state.root; }
  setMotor(c) { Object.assign(this.cmd, c); }
  setPools() {}
  setRates(r) { this.rates = r || {}; }
  setPosture(p) { Object.assign(this.postureTarget, p); }
  trigger(kind) { this.gesture = { kind, t: 0, dur: { retch: 0.9, vomit: 1.6, fart: 0.8, lay: 1.4 }[kind] || 1 }; }
  forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }
  mouth() { return this.state.mouthPos.clone(); }
  butt() { return this.state.buttPos.clone(); }
  headDown() { return this.forward().multiplyScalar(0.7).add(new THREE.Vector3(0, -0.7, 0)).normalize(); }
  /** a knock (N·s, ~60 kg body): real hits throw him into a short uncontrolled tumble (no walking or flight
   *  control cancelling the push); gentle nudges just shove him */
  applyImpulse(_name, v) {
    this.vel.addScaledVector(v, 1 / 60);
    const mag = v.length();
    if (mag > 40 || v.y > 4) {
      this.knockT = Math.max(this.knockT || 0, Math.min(1.2, 0.2 + mag / 400));
      if (!this.flying) { this.flying = true; this.flyT = 0; }
      if (mag > 150 && !this.tumble) {
        const axis = new THREE.Vector3(v.z, 0, -v.x).normalize();
        if (axis.lengthSq() > 0.5) this.tumble = { axis, t: 0, dur: 0.55 + Math.random() * 0.3, turns: Math.random() < 0.5 ? 1 : -1 };
      }
    }
  }
  /** a predator holds the thorax at p (world), or lets go (null) */
  hold(p) { this.heldAt = p ? p.clone() : null; if (!p) this.flying = true; }
  setMouth(v) { for (const [o, i] of this.morphs) o.morphTargetInfluences[i] = v; }

  /** hatchling mode: move on the ground meshes without physics */
  placeMini(p, yaw = 0) { this.pos = p.clone(); this.heading = yaw; this.vel = new THREE.Vector3(); this.altitude = 0; this.root.position.copy(p); for (const l of this.legs) l.planted = false; }

  updateMini(dt) {
    this.t += dt;
    const c = this.cmd;
    for (const k in this.posture) this.posture[k] += ((this.postureTarget[k] || 0) - this.posture[k]) * Math.min(1, dt * 4);
    this.yawRate += (c.turn * 2.6 - this.yawRate) * Math.min(1, dt * 8);
    this.heading += this.yawRate * dt;
    const fwd = this.forward();
    const sp = (c.forward - c.backward) * 3.0 * this.k;
    this.speed += (sp - this.speed) * Math.min(1, dt * 6);
    const next = this.pos.clone().addScaledVector(fwd, this.speed * dt);
    const gy = this.groundBelow(next.clone().setY(next.y + 1));
    if (gy > next.y - 1.2 * this.k * 3) { this.pos.set(next.x, gy, next.z); }        // don't walk off tall drops
    else this.heading += Math.PI * 0.6;
    // flutter: short hops into the air
    this.altitude = this.flying ? Math.min(this.altitude + dt * 2.5, 1.5) : Math.max(0, this.altitude - dt * 2);
    this.root.position.set(this.pos.x, this.pos.y + this.altitude, this.pos.z);
    this.root.quaternion.setFromAxisAngle(UP, this.heading);
    this.pose(dt, !this.flying);
  }

  place(p, yaw = 0) {
    this.pos.copy(p); this.heading = yaw; this.vel.set(0, 0, 0); this.bodyY = 0; this.flying = false; this.knockT = 0; this.tumble = null;
    this.kbody.setTranslation({ x: p.x, y: p.y + 0.05, z: p.z }, true);
    for (const l of this.legs) l.planted = false;
    this.syncState();
  }

  setVisible(v) { this.root.visible = v; }

  update(dt) {
    if (!dt) return;
    this.t += dt;
    const c = this.cmd;
    for (const k in this.posture) this.posture[k] += ((this.postureTarget[k] || 0) - this.posture[k]) * Math.min(1, dt * 4);
    // wing power: flight/song DNs (DNg02, DNp13); escape: giant fiber
    const pw = clamp((this.rates['m:vocal'] ?? 0) / 30, 0, 1);
    this.power += (pw - this.power) * Math.min(1, dt * 3);
    if (!this.flying && (c.startle > 0.6 || this.power > 0.35) && this.posture.eat < 0.3) {
      this.flying = true; this.flyT = 0;
      if (c.startle > 0.6) this.vel.y = 6;           // escape jump
    }
    // keep-on-stage reflex (same idea as the ragdoll's): turn back at the platform rim; in flight stay over it, low
    if (this.keepOnStage && this.stageCenter) {
      const t0 = this.kbody.translation();
      const toC = this.stageCenter.clone().sub(new THREE.Vector3(t0.x, 0, t0.z)).setY(0);
      const dist = toC.length(), limit = this.stageRadius * 0.78, f = this.forward();
      const side = f.z * toC.x - f.x * toC.z;
      if (dist > limit - 1 && f.dot(toC) < 0) { c.turn = Math.sign(side || 1); c.forward *= 0.3; }
      else if (dist > limit - 1) c.backward = 0;
      if (dist > limit) { toC.normalize(); this.vel.x += toC.x * (dist - limit + 0.5) * 6 * dt; this.vel.z += toC.z * (dist - limit + 0.5) * 6 * dt; if (!this.flying) { this.vel.x = toC.x * 1.5; this.vel.z = toC.z * 1.5; } }
      if (this.flying && t0.y > this.stageCenter.y + 4) this.vel.y = Math.min(this.vel.y, -0.5);
    }
    const turnRate = this.flying ? 1.8 : 2.6;
    this.yawRate += (c.turn * turnRate - this.yawRate) * Math.min(1, dt * 8);
    this.heading += this.yawRate * dt;
    const fwd = this.forward();
    let desired;
    if (this.flying && this.knockT > 0) {
      // knocked: ballistic, just gravity and air drag, until he gets his wings back
      this.knockT -= dt; this.flyT += dt;
      this.vel.y -= 9.8 * dt;
      this.vel.multiplyScalar(1 - Math.min(1, dt * 0.6));
      desired = this.vel.clone().multiplyScalar(dt);
    } else if (this.flying) {
      this.flyT += dt;
      // lift ~ wing power (glides down slowly without it); forward thrust from the walking command or cruising
      const climb = (Math.max(this.power, c.startle * 0.8) - 0.3) * 5;
      this.vel.y += (clamp(climb, -2.2, 4) - this.vel.y) * Math.min(1, dt * 2);
      const thrust = 2 + 4 * Math.max(c.forward, this.power * 0.6) - 2 * c.backward;
      this.vel.x += (fwd.x * thrust - this.vel.x) * Math.min(1, dt * 1.5);
      this.vel.z += (fwd.z * thrust - this.vel.z) * Math.min(1, dt * 1.5);
      const alt = this.kbody.translation().y;
      if (alt > 12.5) this.vel.y = Math.min(this.vel.y, (12.5 - alt) * 2);          // studio ceiling
      desired = this.vel.clone().multiplyScalar(dt);
      this.quietT = this.power < 0.15 && c.startle < 0.3 ? this.quietT + dt : 0;
    } else {
      const sp = (c.forward - c.backward) * 3.0 * (1 - this.posture.eat * 0.8) * (1 - this.posture.rub * 0.7);
      this.speed += (sp - this.speed) * Math.min(1, dt * 6);
      const skid = this.knockT > 0 ? 1.5 : 4;                                   // knock-backs decay (slide after a hit)
      this.vel.x *= 1 - Math.min(1, dt * skid); this.vel.z *= 1 - Math.min(1, dt * skid);
      if (this.knockT > 0) this.knockT -= dt;
      this.vel.y = Math.min(0, this.vel.y - 9.8 * dt);
      desired = fwd.clone().multiplyScalar(this.speed * dt).add(this.vel.clone().multiplyScalar(dt));
    }
    // held by a predator (spider-Leno): the thorax is dragged to the grab point, whatever the legs and wings do
    if (this.heldAt) {
      const t0 = this.kbody.translation();
      desired = new THREE.Vector3(this.heldAt.x - t0.x, this.heldAt.y - 0.95 * S - t0.y, this.heldAt.z - t0.z).multiplyScalar(Math.min(1, dt * 6));
      this.vel.set(0, 0, 0);
    }
    // move with the character controller (collides with seats, walls, platform)
    this.ctrl.computeColliderMovement(this.collider, { x: desired.x, y: desired.y, z: desired.z });
    const m = this.ctrl.computedMovement();
    const t = this.kbody.translation();
    const next = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
    this.kbody.setNextKinematicTranslation(next);
    const grounded = this.ctrl.computedGrounded();
    if (this.flying && grounded && this.vel.y <= 0 && this.flyT > (this.knockT > 0 ? 0.15 : 0.6)) {
      this.flying = false;
      if (this.knockT > 0) this.vel.y = 0; else this.vel.set(0, 0, 0);           // a knocked landing keeps sliding
    }
    if (this.flying && this.quietT > 1.2 && grounded) this.flying = false;
    const q = new THREE.Quaternion().setFromAxisAngle(UP, this.heading);
    this.kbody.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    // step the shared physics world (projectiles etc.)
    this.accum = Math.min(this.accum + dt, 8 * DT);
    while (this.accum >= DT) { this.world.step(); this.accum -= DT; }
    const bt = this.kbody.translation();
    this.root.position.set(bt.x, bt.y, bt.z);
    if (grounded && !this.flying) this.vel.y = 0;
    this.root.quaternion.copy(q);
    if (this.tumble) {                                                           // tumbling head over heels after a big hit
      const T = this.tumble; T.t += dt;
      const u = Math.min(1, T.t / T.dur);
      this.root.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(T.axis, T.turns * Math.PI * 2 * (u * (2 - u))));
      if (u >= 1) this.tumble = null;
    }
    this.pose(dt, grounded);
    const hp = this.head.getWorldPosition(new THREE.Vector3());
    this.hbody.setNextKinematicTranslation({ x: hp.x, y: hp.y + 0.15, z: hp.z });
    this.syncState();
  }

  groundBelow(p) {
    if (this.mini) {
      this.ray.set(new THREE.Vector3(p.x, p.y + 2, p.z), new THREE.Vector3(0, -1, 0)); this.ray.far = 30;
      const hit = this.ray.intersectObjects(this.groundMeshes, false)[0];
      return hit ? hit.point.y : p.y - 2;
    }
    const ray = new this.RAPIER.Ray({ x: p.x, y: p.y + 2, z: p.z }, { x: 0, y: -1, z: 0 });
    const hit = this.world.castRay(ray, 20, true, undefined, undefined, undefined, this.kbody);
    return hit ? p.y + 2 - (hit.timeOfImpact ?? hit.toi) : p.y - 2;
  }

  pose(dt, grounded) {
    const P = this.posture, c = this.cmd;
    // body: crouch to eat, bob with the gait, pitch up in flight
    const eatDip = P.eat * 0.35 * S;
    this.body.position.y = -eatDip;
    this.body.rotation.x = this.flying ? -0.25 : P.eat * 0.25;
    // gestures
    let headNod = 0;
    if (this.gesture) {
      const g = this.gesture; g.t += dt; const e = Math.sin(Math.PI * Math.min(1, g.t / g.dur));
      if (g.kind === 'fart' || g.kind === 'lay') this.abdomen.rotation.x = 0.18 - (g.kind === 'lay' ? 0.8 : 0.5) * e;
      else headNod = 0.5 * e * (0.8 + 0.2 * Math.sin(g.t * 30));
      if (g.t >= g.dur) { this.gesture = null; this.abdomen.rotation.x = 0.18; }
    }
    this.head.rotation.set(0.35 * P.eat + headNod + 0.15 * P.rub, clamp(this.yawRate * 0.15, -0.4, 0.4), 0);
    // antennae: small twitches; they flick back when the front legs sweep over the head
    const sweep = c.groom > 0.5 ? 0.35 + 0.25 * Math.sin(this.t * 12) : 0;
    for (const a of this.antennae) {
      a.g.rotation.set(-sweep + 0.06 * Math.sin(this.t * 3.1 + a.side), 0.05 * Math.sin(this.t * 4.7 + 2 * a.side), 0);
    }
    // wings: fold at rest, beat in flight (visually aliased stroke), buzz a little when "singing"
    this.phase += dt * (this.flying ? 55 : 0);
    const song = !this.flying && this.power > 0.12;
    for (const w of this.wings) {
      if (this.flying) { w.rotation.set(0, 0, 0); w.rotation.z = w.side * (0.1 + 0.9 * Math.sin(this.phase)); w.rotation.y = w.side * 0.25 * Math.cos(this.phase); }
      else {
        const vib = song ? 0.25 * Math.sin(this.t * 60) * this.power : 0;          // courtship-song-like wing vibration
        // folded back over the abdomen, slightly apart; during song one wing is extended and vibrated
        const ext = song && w.side === 1 ? 1.1 : 0;
        w.rotation.set(0, w.side * (Math.PI * 0.45 - ext + vib), 0.06 * w.side);
      }
    }
    for (const h of this.halteres) h.rotation.z = h === this.halteres[0] ? 0.6 * Math.sin(this.phase + Math.PI) : -0.6 * Math.sin(this.phase + Math.PI);
    // legs
    const spd = Math.abs(this.speed) + Math.abs(this.yawRate) * 0.6;
    const gaitHz = this.flying ? 0 : clamp(spd * 1.2, 0, 5);
    this.gaitPhase = (this.gaitPhase ?? 0) + dt * gaitHz;
    this.root.updateMatrixWorld(true);
    const rootInv = this.root.matrixWorld.clone().invert();
    for (const L of this.legs) {
      const hipW = this.body.localToWorld(L.hip.clone());
      let footW;
      if (this.flying) {
        // legs tucked and dangling in flight
        footW = this.body.localToWorld(L.hip.clone().add(new THREE.Vector3(0.2 * L.side, -0.45, -0.25 + 0.1 * L.pair)));
      } else if (L.pair === 0 && (P.rub > 0.1 || c.groom > 0.5)) {
        // front legs: rub each other in front of the face, or sweep over the head
        const k = c.groom > 0.5 ? 1 : 0;
        const osc = Math.sin(this.t * 12 + (L.side > 0 ? 0 : Math.PI));
        const local = k ? new THREE.Vector3(0.12 * L.side + 0.08 * osc, 1.45 + 0.15 * osc, 0.55) : new THREE.Vector3(0.06 * L.side + 0.06 * osc * L.side, 0.95, 0.75 + 0.05 * osc);
        footW = this.body.localToWorld(local.multiplyScalar(S));
      } else {
        // alternating tripod: each foot is planted, or swinging toward its rest spot ahead
        const ph = (this.gaitPhase + L.group * 0.5) % 1;
        const rest = this.root.localToWorld(L.rest.clone().add(new THREE.Vector3(0, 0, Math.sign(this.speed || 1) * 0.18)));
        rest.y = this.groundBelow(rest);
        if (!L.planted || gaitHz === 0 && L.plantedAt.distanceTo(rest) > 0.35) { L.plantedAt.copy(rest); L.planted = true; }
        if (gaitHz > 0 && ph < 0.5) {
          const u = ph / 0.5;
          footW = L.plantedAt.clone().lerp(rest, u); footW.y += Math.sin(u * Math.PI) * 0.22 * S * this.k;
          if (u > 0.95) L.plantedAt.copy(rest);
        } else footW = L.plantedAt.clone();
        if (P.eat > 0.3 && L.pair === 0) footW.y += 0; // front feet stay down while feeding
      }
      // two-bone IK (femur, tibia) with the knee pushed up and outward; short tarsus to the foot
      const tarsusLen = 0.22 * S * this.k;
      const ankle = footW.clone().add(new THREE.Vector3(0, tarsusLen * 0.7, 0)).addScaledVector(hipW.clone().sub(footW).setY(0).normalize(), tarsusLen * 0.7);
      const a = 0.55 * S * this.k, b = 0.62 * S * this.k;
      const d = ankle.clone().sub(hipW), dist = clamp(d.length(), 0.05, a + b - 0.01);
      const along = (a * a - b * b + dist * dist) / (2 * dist), h = Math.sqrt(Math.max(0, a * a - along * along));
      const dir = d.clone().normalize();
      const outward = new THREE.Vector3().subVectors(hipW, this.root.position).setY(0).normalize();
      const bendDir = UP.clone().addScaledVector(outward, 0.6).sub(dir.clone().multiplyScalar(UP.clone().addScaledVector(outward, 0.6).dot(dir))).normalize();
      const knee = hipW.clone().addScaledVector(dir, along).addScaledVector(bendDir, h);
      const seg = (mesh, p0, p1) => {
        const v = p1.clone().sub(p0), l = v.length();
        mesh.position.copy(p0).add(p1).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(UP, v.normalize());
        mesh.scale.set(1, Math.max(0.01, l / this.k), 1);
        mesh.position.applyMatrix4(rootInv); mesh.quaternion.premultiply(this.root.quaternion.clone().invert());
      };
      seg(L.femur, hipW, knee); seg(L.tibia, knee, ankle); seg(L.tarsus, ankle, footW);
    }
  }

  syncState() {
    const s = this.state;
    const t = this.kbody.translation();
    s.root.set(t.x, t.y, t.z);
    s.heading = this.heading; s.yawRate = this.yawRate;
    this.root.updateMatrixWorld(true);
    this.head.getWorldPosition(s.headPos); s.headPos.y += 0.2;
    this.head.localToWorld(s.mouthPos.copy(this.mouthLocal));
    this.abdomen.localToWorld(s.buttPos.set(0, 0, -0.52 * S));
    s.fallen = false; s.upright = 1;
  }

  dispose() {
    this.scene.remove(this.root);
    try { this.world.removeRigidBody(this.kbody); this.world.removeRigidBody(this.hbody); this.world.removeCharacterController(this.ctrl); } catch { /* ignore */ }
  }
}
