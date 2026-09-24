// Tomatoes, metal pipes, roses and sugar cubes thrown at Leno: Rapier rigid bodies in the ragdoll's physics world, so they
// knock his body parts around. Impacts are detected from sudden velocity changes; a hit on Leno is an
// impact within reach of one of his bodies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { keep, disposeObject } from './dispose.js';

const G_GROUND = 1;   // must match js/ragdoll.js: projectiles join the "ground" group so ragdoll parts collide with them
const groups = (member, filter) => ((member & 0xffff) << 16) | (filter & 0xffff);
const MAX_ITEMS = 40;

export class Projectiles {
  constructor(scene, host, { onImpact, onApproach, onSplat } = {}) {
    this.onSplat = onSplat;         // (position) => void, for juice particles
    this.scene = scene;
    this.host = host;               // PhysicsLeno (needs .RAPIER, .world, .rag)
    this.onImpact = onImpact;       // (item, { hitLeno, bodyName, speed }) => void
    this.onApproach = onApproach;   // (item) => void, once when a projectile is about to hit Leno's head
    this.items = [];
    this.tomatoGeo = new THREE.IcosahedronGeometry(0.11, 1);
    this.tomatoMat = new THREE.MeshStandardMaterial({ color: 0xc8231c, roughness: 0.45 });
    this.splatMat = new THREE.MeshStandardMaterial({ color: 0xa3140f, roughness: 0.9, transparent: true });
    this.stemMat = new THREE.MeshStandardMaterial({ color: 0x2f7d2a });
    this.stemGeo = new THREE.ConeGeometry(0.03, 0.05, 5);
    this.splatGeo = { leno: new THREE.IcosahedronGeometry(0.2, 1), floor: new THREE.IcosahedronGeometry(0.32, 1) };
    this.pipeGeo = new THREE.CylinderGeometry(0.045, 0.045, 1.3, 12, 1);
    this.pipeMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 });
    this.splats = [];
    for (const r of [this.tomatoGeo, this.tomatoMat, this.splatMat, this.stemMat, this.stemGeo, this.splatGeo.leno, this.splatGeo.floor, this.pipeGeo, this.pipeMat]) keep(r);
  }

  get ready() { return !!(this.host?.rag && this.host?.RAPIER); }

  /** a studio camera or a stage light falls from the rig at `from` (THREE.Vector3) */
  drop(kind, from) {
    if (!this.ready) return null;
    const R = this.host.RAPIER, world = this.host.world;
    const body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setCcdEnabled(true)
      .setAngvel({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 2, z: (Math.random() - 0.5) * 3 }));
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c20, metalness: 0.6, roughness: 0.4 });
    const g = new THREE.Group();
    let collider;
    if (kind === 'camera') {
      // a studio TV camera: body, lens hood, viewfinder, pan handles
      g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.45, 0.8), new THREE.MeshStandardMaterial({ color: 0x3a3d44, metalness: 0.4, roughness: 0.5 })));
      const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.35, 16).rotateX(Math.PI / 2), dark); lens.position.z = 0.55; g.add(lens);
      const glass = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), new THREE.MeshStandardMaterial({ color: 0x223355, metalness: 0.9, roughness: 0.05 }));
      glass.position.z = 0.73; g.add(glass);
      const vf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.25), dark); vf.position.set(0, 0.33, -0.2); g.add(vf);
      for (const x of [-0.3, 0.3]) { const h = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6).rotateX(Math.PI / 2), dark); h.position.set(x, -0.1, -0.6); g.add(h); }
      const tally = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff2020, emissiveIntensity: 2 }));
      tally.position.set(0, 0.26, 0.3); g.add(tally);
      collider = R.ColliderDesc.cuboid(0.26, 0.24, 0.5).setMass(14);
    } else {
      // a stage light: can with a hot lens, yoke
      g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 14).rotateX(Math.PI / 2), dark));
      const lensM = new THREE.Mesh(new THREE.CircleGeometry(0.2, 16), new THREE.MeshStandardMaterial({ color: 0xfff4d0, emissive: 0xffe6a0, emissiveIntensity: 3 }));
      lensM.position.z = 0.31; g.add(lensM);
      const yoke = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 6, 16, Math.PI).rotateZ(Math.PI), dark); g.add(yoke);
      collider = R.ColliderDesc.cylinder(0.3, 0.26).setRotation({ x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 }).setMass(9);
    }
    world.createCollider(collider.setRestitution(0.3).setFriction(0.6).setCollisionGroups(groups(G_GROUND, 0xffff)), body);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return this.add({ kind, body, mesh: g, v: new THREE.Vector3() });
  }

  /** a long-stemmed red rose */
  roseMesh() {
    if (!this.roseParts) {
      const green = new THREE.MeshStandardMaterial({ color: 0x2f7d2a, roughness: 0.6 }), red = new THREE.MeshStandardMaterial({ color: 0xb0101c, roughness: 0.5 });
      const bloom = [];
      for (let k = 0; k < 7; k++) {                     // cupped petals around a bud
        const a = k / 7 * Math.PI * 2, r = k < 3 ? 0.02 : 0.04;
        bloom.push(new THREE.SphereGeometry(0.035, 6, 4).scale(1, 1.3, 0.45).rotateX(-0.35).rotateY(-a).translate(Math.sin(a) * r, 0.24 + (k < 3 ? 0.02 : 0), Math.cos(a) * r));
      }
      this.roseParts = [
        [new THREE.CylinderGeometry(0.007, 0.009, 0.45, 5), green],
        [new THREE.SphereGeometry(0.03, 5, 3).scale(1.8, 0.25, 0.9).translate(0.03, -0.02, 0), green],
        [mergeGeometries(bloom.map((g) => g.toNonIndexed())), red],
      ];
    }
    const g = new THREE.Group();
    for (const [geo, mat] of this.roseParts) g.add(new THREE.Mesh(keep(geo), keep(mat)));
    return g;
  }

  /** a sugar cube (the audience being kind): light, lobbed, lands on the floor as food */
  sugarMesh() {
    this.sugarGeo ||= keep(new THREE.BoxGeometry(0.15, 0.15, 0.15));
    this.sugarMat ||= keep(new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.6 }));
    return new THREE.Mesh(this.sugarGeo, this.sugarMat);
  }

  /** throw `kind` ('tomato' | 'pipe' | 'rose' | 'sugar') from `from` (THREE.Vector3): at Leno's head/chest, or for a
   *  sugar cube a gentle lob to the floor just in front of him */
  throw(kind, from) {
    if (!this.ready) return null;
    const R = this.host.RAPIER, world = this.host.world;
    const st = this.host.rag.getState();
    let target;
    const f = new THREE.Vector3(Math.sin(st.heading), 0, Math.cos(st.heading)), side = new THREE.Vector3(f.z, 0, -f.x);
    if (kind === 'sugar' || (kind === 'rose' && Math.random() < 0.5)) {
      // a gentle lob to the floor just in front of him
      target = st.root.clone().addScaledVector(f, 0.9 + Math.random() * 0.8).addScaledVector(side, (Math.random() - 0.5) * 1.2);
    } else if (kind === 'rose') target = st.root.clone().add(new THREE.Vector3(0, 1.3, 0));   // tossed to his chest, never at his face
    else target = (Math.random() < 0.6 ? st.headPos : st.root.clone().add(new THREE.Vector3(0, 1.3, 0))).clone();
    // ballistic aim with a chosen flight time (roses and sugar are slow, arcing lobs); lead the target a little
    const d = target.clone().sub(from);
    const gentle = kind === 'sugar' || kind === 'rose';
    const T = THREE.MathUtils.clamp(d.length() / (kind === 'pipe' ? 13 : kind === 'rose' ? 8 : kind === 'sugar' ? 9 : 16), gentle ? 0.9 : 0.45, 2.2);
    const g = -9.81;
    const v = new THREE.Vector3(d.x / T, (d.y - 0.5 * g * T * T) / T, d.z / T);
    v.x += (Math.random() - 0.5) * 0.8; v.z += (Math.random() - 0.5) * 0.8;   // human inaccuracy

    const bodyDesc = R.RigidBodyDesc.dynamic().setTranslation(from.x, from.y, from.z).setCcdEnabled(true)
      .setLinvel(v.x, v.y, v.z);
    let mesh, collider;
    if (kind === 'pipe') {
      bodyDesc.setAngvel({ x: (Math.random() - 0.5) * 20, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 20 });
      const body = world.createRigidBody(bodyDesc);
      collider = world.createCollider(R.ColliderDesc.cylinder(0.65, 0.045).setMass(2.2).setRestitution(0.45).setFriction(0.4)
        .setCollisionGroups(groups(G_GROUND, 0xffff)), body);
      mesh = new THREE.Mesh(this.pipeGeo, this.pipeMat);
      return this.add({ kind, body, collider, mesh, v });
    }
    if (kind === 'rose') {
      // 50 g: even a direct hit is a ~0.4 N·s nudge on an 81 kg body (a pipe is ~30); no knockback, no injury
      bodyDesc.setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 8 });
      const body = world.createRigidBody(bodyDesc);
      collider = world.createCollider(R.ColliderDesc.capsule(0.2, 0.03).setMass(0.05).setRestitution(0.1).setFriction(0.8)
        .setCollisionGroups(groups(G_GROUND, 0xffff)), body);
      return this.add({ kind, body, collider, mesh: this.roseMesh(), v });
    }
    if (kind === 'sugar') {
      // feather-light (it can't hurt or shove him); it tumbles a little and settles
      bodyDesc.setAngvel({ x: (Math.random() - 0.5) * 6, y: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 6 }).setLinearDamping(0.8).setAngularDamping(2);
      const body = world.createRigidBody(bodyDesc);
      collider = world.createCollider(R.ColliderDesc.cuboid(0.075, 0.075, 0.075).setMass(0.02).setRestitution(0.15).setFriction(0.9)
        .setCollisionGroups(groups(G_GROUND, 0xffff)), body);
      return this.add({ kind, body, collider, mesh: this.sugarMesh(), v });
    }
    const body = world.createRigidBody(bodyDesc);
    collider = world.createCollider(R.ColliderDesc.ball(0.11).setMass(0.2).setRestitution(0.05).setFriction(0.9)
      .setCollisionGroups(groups(G_GROUND, 0xffff)), body);
    mesh = new THREE.Mesh(this.tomatoGeo, this.tomatoMat);
    const stem = new THREE.Mesh(this.stemGeo, this.stemMat); stem.position.y = 0.11; mesh.add(stem);
    return this.add({ kind, body, collider, mesh, v });
  }

  add(item) {
    item.mesh.castShadow = true;
    item.prevVel = item.v.clone();
    item.age = item.kind === 'camera' || item.kind === 'light' ? -15 : 0;     // rig pieces lie around a bit longer
    item.clangs = 0; item.splatted = false; item.warned = false;
    this.scene.add(item.mesh);
    this.items.push(item);
    while (this.items.length > MAX_ITEMS) this.remove(this.items[0]);
    return item;
  }

  remove(item) {
    disposeObject(item.mesh);                     // rig pieces are one-offs; shared geometries are kept
    try { this.host.world.removeRigidBody(item.body); } catch { /* already gone */ }
    this.items.splice(this.items.indexOf(item), 1);
  }

  /** stop simulating `item` but leave its mesh in the scene (a sugar cube handed over to the food) */
  detach(item) {
    try { this.host.world.removeRigidBody(item.body); } catch { /* already gone */ }
    this.items.splice(this.items.indexOf(item), 1);
  }

  nearestLenoBody(p) {
    let best = null, bd = Infinity;
    for (const [name, b] of Object.entries(this.host.rag.bodies)) {
      const t = b.translation();
      const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      if (d < bd) { bd = d; best = name; }
    }
    return { name: best, dist: bd };
  }

  update(dt) {
    if (!this.ready) return;
    const head = this.host.rag.getState().headPos;
    for (const it of [...this.items]) {
      it.age += dt;
      const t = it.body.translation(), r = it.body.rotation(), lv = it.body.linvel();
      it.mesh.position.set(t.x, t.y, t.z);
      it.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      const vel = new THREE.Vector3(lv.x, lv.y, lv.z);
      // looming: about to hit the head (for the fly's LC4 looming detectors)
      if (!it.warned && !it.splatted && it.kind !== 'sugar' && it.kind !== 'rose') {   // (a lobbed sugar cube or rose isn't a threat)
        const toHead = head.clone().sub(it.mesh.position);
        if (toHead.length() < 4 && vel.dot(toHead) > 0) { it.warned = true; this.onApproach?.(it); }
      }
      // impact = sudden change of velocity (not explained by gravity)
      const dv = vel.clone().sub(it.prevVel).add(new THREE.Vector3(0, 9.81 * dt, 0)).length();
      const speed = it.prevVel.length();
      if (dv > 2.5 && speed > 2) {
        const near = this.nearestLenoBody(it.mesh.position);
        const hitLeno = near.dist < (it.kind === 'tomato' || it.kind === 'rose' || it.kind === 'sugar' ? 0.6 : it.kind === 'pipe' ? 0.8 : 0.95);
        if (it.kind === 'tomato' && !it.splatted) {
          it.splatted = true;
          this.splat(it, hitLeno ? near.name : null);
          this.onImpact?.(it, { hitLeno, bodyName: near.name, speed });
        } else if (it.kind !== 'tomato' && it.clangs < (it.kind === 'rose' || it.kind === 'sugar' ? 1 : 4)) {
          it.clangs++;
          this.onImpact?.(it, { hitLeno, bodyName: near.name, speed });
        }
      }
      it.prevVel.copy(vel);
      // a sugar cube that has come to rest becomes food on the floor (the body goes, the mesh stays)
      if (it.kind === 'sugar' && it.age > 0.6) {
        it.still = vel.length() < 0.25 ? (it.still || 0) + dt : 0;
        if (it.still > 0.35 || it.age > 8) {
          const p = it.mesh.position.clone(), g = this.groundBelow(p);
          if (g && p.y - g.y < 0.4) p.y = g.y + 0.075;
          this.detach(it);
          this.onRest?.(it, p);
          continue;
        }
      }
      if (it.age > 45 || t.y < -20) this.remove(it);
    }
    for (const s of [...this.splats]) {
      s.life -= dt;
      if (s.follow) { const b = this.host.rag.bodies[s.follow]; if (b) { const p = b.translation(); s.mesh.position.set(p.x + s.off.x, p.y + s.off.y, p.z + s.off.z); } }
      s.mesh.material.opacity = Math.min(1, s.life / 3);
      if (s.life <= 0) { disposeObject(s.mesh); this.splats.splice(this.splats.indexOf(s), 1); }
    }
  }

  /** the floor / stage surface under p (the tomato may have burst on a wall, a seat back or a curtain) */
  groundBelow(p) {
    if (!this.ground?.length) return null;
    this.ray ||= new THREE.Raycaster();
    this.ray.set(new THREE.Vector3(p.x, p.y + 0.4, p.z), new THREE.Vector3(0, -1, 0)); this.ray.far = 60;
    const hit = this.ray.intersectObjects(this.ground, false)[0];
    return hit ? hit.point : null;
  }

  /** a tomato bursts: remove the body, leave a squashed splat (stuck to Leno's body part if it hit him,
   *  otherwise the pulp lands on the surface below the impact) */
  splat(it, bodyName) {
    const p = it.mesh.position.clone();
    this.remove(it);
    const rest = bodyName ? p : (this.groundBelow(p) ?? p);
    this.onSplat?.(p, bodyName, rest);
    const mesh = new THREE.Mesh(bodyName ? this.splatGeo.leno : this.splatGeo.floor, this.splatMat.clone());   // own material: it fades
    mesh.position.copy(rest);
    if (bodyName) { mesh.scale.set(1, 0.4, 1); mesh.rotation.set(Math.random(), Math.random(), Math.random()); }
    else { mesh.scale.set(1, 0.12, 1.2); mesh.rotation.y = Math.random() * 6.28; mesh.position.y += 0.015; }   // squashed flat on the floor
    this.scene.add(mesh);
    let off = null;
    if (bodyName) { const b = this.host.rag.bodies[bodyName].translation(); off = new THREE.Vector3(p.x - b.x, p.y - b.y, p.z - b.z); }
    this.splats.push({ mesh, life: bodyName ? 12 : 25, follow: bodyName, off });
  }
}
