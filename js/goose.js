// A low-poly goose that wanders onto the stage at random intervals (every ~1-3 minutes), honks, and defecates profusely. Its droppings are
// food in the world (js/food.js, kind 'poop') - ignored by humanoid Leno, but Fly-Leno happily seeks them out,
// as flies do.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propLOD } from './lod.js';

const SCALE = 1.4;                        // the set is ~1.4x human scale

function col(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}

function gooseModel() {
  const WHITE = 0xf2f0ea, GREY = 0xd2d0c8, ORANGE = 0xf08a1c, BLACK = 0x111111;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.8 });
  const g = new THREE.Group();
  // body: a faceted egg, tail tip, folded wings
  const body = mergeGeometries([
    col(new THREE.IcosahedronGeometry(0.2, 1).scale(1, 0.85, 1.45).translate(0, 0.32, -0.02), WHITE),
    col(new THREE.ConeGeometry(0.09, 0.2, 5).rotateX(-Math.PI / 2 - 0.4).translate(0, 0.38, -0.34), WHITE),
    col(new THREE.IcosahedronGeometry(0.12, 0).scale(0.55, 0.7, 1.9).translate(0.15, 0.36, -0.05), GREY),
    col(new THREE.IcosahedronGeometry(0.12, 0).scale(0.55, 0.7, 1.9).translate(-0.15, 0.36, -0.05), GREY),
  ]);
  g.add(new THREE.Mesh(body, mat));
  // neck + head as a group so the neck can bob / stretch to honk
  const neck = new THREE.Group(); neck.position.set(0, 0.4, 0.2);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.16, 0.08), new THREE.Vector3(0, 0.34, 0.06), new THREE.Vector3(0, 0.44, 0.1)]);
  const head = mergeGeometries([
    col(new THREE.TubeGeometry(curve, 6, 0.05, 6), WHITE),
    col(new THREE.IcosahedronGeometry(0.075, 0).scale(1, 0.9, 1.25).translate(0, 0.47, 0.13), WHITE),
    col(new THREE.ConeGeometry(0.04, 0.13, 5).rotateX(Math.PI / 2).translate(0, 0.45, 0.26), ORANGE),
    col(new THREE.SphereGeometry(0.013, 5, 4).translate(0.045, 0.49, 0.17), BLACK),
    col(new THREE.SphereGeometry(0.013, 5, 4).translate(-0.045, 0.49, 0.17), BLACK),
  ]);
  const headMesh = new THREE.Mesh(head, mat); neck.add(headMesh); g.add(neck);
  // legs with webbed feet (each its own group for the waddle)
  const legs = [-1, 1].map((s) => {
    const L = new THREE.Group(); L.position.set(0.08 * s, 0.2, 0.02);
    const geo = mergeGeometries([
      col(new THREE.CylinderGeometry(0.018, 0.02, 0.2, 5).translate(0, -0.1, 0), ORANGE),
      col(new THREE.ConeGeometry(0.07, 0.02, 3).rotateY(Math.PI / 6).scale(1, 1, 1.4).translate(0, -0.2, 0.05), ORANGE),
    ]);
    L.add(new THREE.Mesh(geo, mat)); g.add(L); return L;
  });
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(SCALE);
  return { g, neck, legs };
}

export class Goose {
  constructor({ scene, stage, food, audio, onEvent }) {
    Object.assign(this, { scene, stage, food, audio, onEvent });
    this.active = null;
    this.nextT = 45 + Math.random() * 60;       // first visit
    this.enabled = true;
    this.ray = new THREE.Raycaster();
    const c = stage.markers.stageCenter.position;
    this.center = new THREE.Vector3(c[0], c[1], c[2]);
    this.poopGeo = new THREE.IcosahedronGeometry(0.07, 0).scale(1, 0.55, 1.5);
    this.poopMat = new THREE.MeshStandardMaterial({ color: 0x4a4a22, roughness: 0.55, metalness: 0.05 });
  }

  groundAt(p) {
    this.ray.set(new THREE.Vector3(p.x, p.y + 3, p.z), new THREE.Vector3(0, -1, 0)); this.ray.far = 10;
    const hit = this.ray.intersectObjects(this.stage.ground, false)[0];
    return hit ? hit.point.y : p.y;
  }

  /** a goose waddles on from a wing */
  spawn() {
    if (this.active) return;
    const m = gooseModel();
    const side = Math.random() < 0.5 ? -1 : 1;
    const start = this.center.clone().add(new THREE.Vector3(side * 12, 0, -2 + Math.random() * 6));
    start.y = this.groundAt(start);
    m.g.position.copy(start);
    this.scene.add(m.g); propLOD.track(m.g);
    const stops = Array.from({ length: 4 + ((Math.random() * 4) | 0) }, () => {
      const a = Math.random() * 6.28, r = 1 + Math.random() * 6;
      return this.center.clone().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r + 1.5));
    });
    this.active = { ...m, start, stops, exit: start.clone(), t: 0, poopT: 1, honkT: 0.5, phase: 0, pause: 0 };
    this.onEvent?.('enter');
  }

  headPos() { return this.active ? this.active.neck.localToWorld(new THREE.Vector3(0, 0.47, 0.13)) : null; }

  update(dt, showOn) {
    if (!dt) return;
    if (!this.active) {
      if (!this.enabled || !showOn) return;
      this.nextT -= dt;
      if (this.nextT <= 0) { this.nextT = 70 + Math.random() * 110; this.spawn(); }
      return;
    }
    const A = this.active, g = A.g;
    A.t += dt;
    const target = A.stops[0] ?? A.exit;
    const d = target.clone().sub(g.position).setY(0), dist = d.length();
    let moving = false;
    if (A.pause > 0) A.pause -= dt;
    else if (dist > 0.25) {
      const yaw = Math.atan2(d.x, d.z);
      let dy = yaw - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      g.rotation.y += dy * Math.min(1, dt * 5);
      g.position.addScaledVector(d.normalize(), Math.min(1.1, dist * 2) * dt);
      g.position.y += (this.groundAt(g.position) - g.position.y) * Math.min(1, dt * 10);
      moving = true;
    } else if (A.stops.length) { A.stops.shift(); A.pause = 0.8 + Math.random() * 2; }
    else { this.scene.remove(g); this.active = null; this.onEvent?.('leave'); return; }
    // waddle: body rolls side to side, legs step, neck bobs forward with each step
    A.phase += dt * (moving ? 9 : 2);
    g.rotation.z = moving ? Math.sin(A.phase) * 0.12 : 0;
    A.legs[0].rotation.x = moving ? Math.sin(A.phase) * 0.5 : 0; A.legs[1].rotation.x = moving ? -Math.sin(A.phase) * 0.5 : 0;
    A.neck.rotation.x = moving ? 0.15 + Math.sin(A.phase * 2) * 0.12 : 0.05 * Math.sin(A.t * 3);
    // honk: neck stretches up
    A.honkT -= dt;
    if (A.honkT < 0.4) A.neck.rotation.x = -0.35 * Math.sin(Math.max(0, A.honkT) / 0.4 * Math.PI);
    if (A.honkT <= 0) {
      A.honkT = 2.5 + Math.random() * 5;
      const p = g.position; this.audio.sfx('honk', { gain: 0.9 });
      this.onEvent?.('honk', p);
    }
    // defecating, profusely
    A.poopT -= dt;
    if (A.poopT <= 0) {
      A.poopT = 0.5 + Math.random() * 1.1;
      const behind = g.localToWorld(new THREE.Vector3(0, 0.3, -0.42));
      const p = new THREE.Vector3(behind.x, this.groundAt(behind) + 0.03, behind.z);
      const mesh = new THREE.Mesh(this.poopGeo, this.poopMat);
      mesh.rotation.y = Math.random() * 6.28; mesh.scale.setScalar(0.8 + Math.random() * 0.6);
      this.food.addPoop(p, mesh);
      this.audio.sfx('splat', { gain: 0.18 });
    }
  }

  clear() { if (this.active) { this.scene.remove(this.active.g); this.active = null; } }
}
