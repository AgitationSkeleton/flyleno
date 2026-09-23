// "It's like a Sunday drive... drive your cars home safe." A low-poly vintage roadster (the host is half
// Jay Leno, and Jay Leno is a car collector) rolls on from the wings, laps the stage, slows and honks when the
// host is in the way, then drives off. For the fly it is loud low-frequency rumble (JO-B, through the in-world
// audio), substrate vibration (leg mechanosensors) and, when it heads toward him, a looming object (LC4).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propLOD } from './lod.js';

const S = 1.4;

function col(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}

function carModel() {
  const PAINT = 0x8e1b1b, CREAM = 0xefe6cf, CHROME = 0xcfd3d6, TIRE = 0x151515, SEAT = 0x5a3a22, GLASS = 0x9fc4d8;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0.35 });
  const g = new THREE.Group();
  const fender = (x, z) => col(new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(x, 0.42, z), PAINT);
  const body = mergeGeometries([
    col(new THREE.BoxGeometry(1.5, 0.42, 3.6).translate(0, 0.62, 0), PAINT),                  // body tub
    col(new THREE.BoxGeometry(1.1, 0.34, 1.35).translate(0, 0.72, 1.35), PAINT),               // long hood
    col(new THREE.BoxGeometry(1.52, 0.06, 3.62).translate(0, 0.85, 0), CREAM),                 // beltline stripe
    col(new THREE.BoxGeometry(1.3, 0.3, 0.9).translate(0, 0.7, -1.2), SEAT),                   // bench seat
    col(new THREE.BoxGeometry(1.3, 0.45, 0.14).translate(0, 1.0, -1.55), SEAT),                // seat back
    col(new THREE.BoxGeometry(1.25, 0.34, 0.04).rotateX(-0.35).translate(0, 1.08, 0.55), GLASS),   // windscreen
    col(new THREE.BoxGeometry(0.9, 0.46, 0.08).translate(0, 0.62, 2.02), CHROME),              // grille
    col(new THREE.BoxGeometry(1.7, 0.1, 0.12).translate(0, 0.38, 2.05), CHROME),               // bumpers
    col(new THREE.BoxGeometry(1.7, 0.1, 0.12).translate(0, 0.38, -1.85), CHROME),
    col(new THREE.TorusGeometry(0.16, 0.025, 5, 10).rotateX(Math.PI / 2 - 0.6).translate(0.35, 0.95, -0.2), TIRE),   // steering wheel
    fender(0.78, 1.3), fender(-0.78, 1.3), fender(0.78, -1.15), fender(-0.78, -1.15),
  ]);
  g.add(new THREE.Mesh(body, mat));
  // headlights (emissive) and wheels (spin)
  const lampMat = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff0c0, emissiveIntensity: 2.5 });
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), lampMat); l.position.set(0.55 * s, 0.82, 1.95); g.add(l); }
  const wheelGeo = mergeGeometries([
    col(new THREE.CylinderGeometry(0.36, 0.36, 0.24, 14).rotateZ(Math.PI / 2), TIRE),
    col(new THREE.CylinderGeometry(0.24, 0.24, 0.26, 14).rotateZ(Math.PI / 2), CREAM),         // whitewalls
    col(new THREE.CylinderGeometry(0.12, 0.12, 0.28, 8).rotateZ(Math.PI / 2), CHROME),
    col(new THREE.BoxGeometry(0.29, 0.05, 0.4), CHROME),                                       // spokes (show rotation)
  ]);
  const wheels = [[0.78, 1.3], [-0.78, 1.3], [0.78, -1.15], [-0.78, -1.15]].map(([x, z]) => {
    const w = new THREE.Mesh(wheelGeo, mat); w.position.set(x, 0.36, z); g.add(w); return w;
  });
  const beams = new THREE.SpotLight(0xfff0c8, 60, 18, 0.5, 0.6, 1.5);
  beams.position.set(0, 0.85, 2.0); beams.target.position.set(0, 0, 8); g.add(beams, beams.target);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(S);
  return { g, wheels };
}

export class Car {
  constructor({ scene, stage, sfx, onEvent }) {
    Object.assign(this, { scene, stage, sfx, onEvent });
    this.active = null;
    this.ray = new THREE.Raycaster();
    const c = stage.markers.stageCenter.position;
    this.center = new THREE.Vector3(c[0], c[1], c[2]);
  }

  get present() { return !!this.active; }

  groundAt(p) {
    this.ray.set(new THREE.Vector3(p.x, p.y + 4, p.z), new THREE.Vector3(0, -1, 0)); this.ray.far = 12;
    const hit = this.ray.intersectObjects(this.stage.ground, false)[0];
    return hit ? hit.point.y : p.y;
  }

  /** drive on for `laps` laps of radius R around the stage centre */
  enter({ laps = 1.5, R = 5.5 } = {}) {
    if (this.active) return;
    const m = carModel(), side = Math.random() < 0.5 ? -1 : 1;
    const start = this.center.clone().add(new THREE.Vector3(side * 16, 0, 2));
    m.g.position.copy(start); m.g.position.y = this.groundAt(start);
    this.scene.add(m.g); propLOD.track(m.g);
    this.active = { ...m, dir: -side, R, ang: null, lapLeft: laps * Math.PI * 2, speed: 0, phase: 'in', exit: start, honkT: 0, engine: this.sfx.engine() };
    this.onEvent?.('enter');
  }

  clear() {
    if (!this.active) return;
    this.active.engine.stop(); this.scene.remove(this.active.g); this.active = null;
  }

  /** front of the car (for looming) */
  front() { return this.active ? this.active.g.localToWorld(new THREE.Vector3(0, 0.8, 2.0)) : null; }

  /** collider capsules along the car */
  colliders() {
    if (!this.active) return [];
    const g = this.active.g;
    return [0.9, -0.8].map((z, k) => ({ key: 'car' + k, pos: g.localToWorld(new THREE.Vector3(0, 0, z)), radius: 1.05, height: 1.6 }));
  }

  update(dt, hostPos) {
    const A = this.active;
    if (!A || !dt) return;
    const g = A.g;
    let target, want = 3.2;
    if (A.phase === 'in') {
      // head for the lap circle
      const a0 = Math.atan2(g.position.z - this.center.z, g.position.x - this.center.x);
      target = this.center.clone().add(new THREE.Vector3(Math.cos(a0) * A.R, 0, Math.sin(a0) * A.R));
      if (g.position.clone().setY(0).distanceTo(target.clone().setY(0)) < 1) { A.phase = 'lap'; A.ang = a0; }
    }
    if (A.phase === 'lap') {
      A.ang += A.dir * (A.speed / A.R) * dt;
      A.lapLeft -= Math.abs(A.speed / A.R) * dt;
      const lead = A.ang + A.dir * 0.5;
      target = this.center.clone().add(new THREE.Vector3(Math.cos(lead) * A.R, 0, Math.sin(lead) * A.R));
      if (A.lapLeft <= 0) { A.phase = 'out'; this.onEvent?.('leaving'); }
    }
    if (A.phase === 'out') {
      target = A.exit;
      if (g.position.clone().setY(0).distanceTo(A.exit.clone().setY(0)) < 1.5) { this.clear(); this.onEvent?.('gone'); return; }
    }
    // steer toward the target
    const d = target.clone().sub(g.position).setY(0);
    let dy = Math.atan2(d.x, d.z) - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += THREE.MathUtils.clamp(dy, -1.2 * dt, 1.2 * dt);
    // the host in the way: brake and honk
    const fwd = new THREE.Vector3(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    const toHost = hostPos.clone().sub(g.position).setY(0);
    const ahead = toHost.dot(fwd), lateral = Math.abs(toHost.clone().addScaledVector(fwd, -ahead).length());
    A.honkT -= dt;
    if (ahead > 0 && ahead < 6 * S / 1.4 && lateral < 1.8) {
      A.blocked = (A.blocked || 0) + dt;
      want = A.blocked > 4 ? 0.7 : ahead < 3.5 ? 0 : 1.2;       // after a while it just nudges him along
      if (A.honkT <= 0) { A.honkT = 2.2; this.sfx.horn({ gain: 0.8 }); this.onEvent?.('honk'); }
    } else A.blocked = 0;
    A.speed += THREE.MathUtils.clamp(want - A.speed, -6 * dt, 2 * dt);
    g.position.addScaledVector(fwd, A.speed * dt);
    g.position.y += (this.groundAt(g.position) - g.position.y) * Math.min(1, dt * 8);
    for (const w of A.wheels) w.rotation.x += A.speed * dt / (0.36 * S);
    g.rotation.z = 0.01 * Math.sin(performance.now() / 45) * (0.3 + A.speed / 3);     // idle shake
    A.engine.set(Math.min(1, A.speed / 3.2), 0.28 + 0.25 * Math.min(1, A.speed / 3.2));
  }

  /** 0..1: how strongly the stage floor under `p` is shaking from the engine */
  rumbleAt(p) {
    if (!this.active) return 0;
    const d = this.active.g.position.distanceTo(p);
    return Math.max(0, 1 - d / 9) * (0.5 + 0.5 * Math.min(1, this.active.speed / 3.2));
  }
}
