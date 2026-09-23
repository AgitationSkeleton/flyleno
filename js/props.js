// Stage props and effects for the show segments (js/show.js):
//   FollowSpot  - a spotlight that swings between targets ("Take it away, Johnny!")
//   BandStand   - Johnny's empty stool and microphone
//   DiscoLights - coloured sweeping beams + strobe for the dance party
//   Confetti    - falling paper squares (touch the host -> antennal mechanosensors, like dust)
//   Balloons    - a campaign balloon drop ("Vote Leno in the fall")
//   Ufo         - Grey Leno's ride home, with a tractor beam
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propLOD } from './lod.js';
import { keep, disposeObject } from './dispose.js';

const v3 = (a) => new THREE.Vector3(a[0], a[1], a[2]);

export class FollowSpot {
  constructor(scene, from) {
    this.light = new THREE.SpotLight(0xfff4dc, 0, 60, 0.16, 0.35, 1.2);
    this.light.position.copy(from);
    scene.add(this.light, this.light.target);
    this.aim = null; this.level = 0; this.want = 0;
  }
  /** point at a position (or a function returning one) */
  on(target, level = 900) { this.aim = target; this.want = level; }
  off() { this.want = 0; }
  update(dt) {
    this.level += (this.want - this.level) * Math.min(1, dt * 4);
    this.light.intensity = this.level;
    if (this.aim) {
      const p = typeof this.aim === 'function' ? this.aim() : this.aim;
      this.light.target.position.lerp(p, Math.min(1, dt * 2.2));
    }
  }
  /** 0..1: how much of the spot falls on p */
  on01(p) {
    if (this.level < 10) return 0;
    const d = this.light.target.position.clone().setY(p.y).distanceTo(p);
    return Math.max(0, 1 - d / 2.2) * Math.min(1, this.level / 900);
  }
}

export class BandStand {
  constructor(scene, at) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1f, metalness: 0.7, roughness: 0.35 });
    const seat = new THREE.MeshStandardMaterial({ color: 0x7a1414, roughness: 0.6 });
    const g = new THREE.Group();
    g.add(new THREE.Mesh(mergeGeometries([
      new THREE.CylinderGeometry(0.04, 0.04, 1.05, 6).translate(0, 0.52, 0),
      new THREE.TorusGeometry(0.2, 0.02, 4, 10).rotateX(Math.PI / 2).translate(0, 0.35, 0),
      new THREE.CylinderGeometry(0.03, 0.03, 1.6, 6).translate(0.6, 0.8, 0.2),                       // mic stand
      new THREE.CylinderGeometry(0.2, 0.25, 0.04, 10).translate(0.6, 0.02, 0.2),
      new THREE.CylinderGeometry(0.2, 0.25, 0.04, 10).translate(0, 0.02, 0),
      new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).rotateZ(1.1).translate(0.45, 1.65, 0.2),
    ]), mat));
    const cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.08, 12).translate(0, 1.08, 0), seat);
    const mic = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.12, 4, 8).rotateZ(1.1).translate(0.24, 1.76, 0.2), mat);
    g.add(cushion, mic);
    g.scale.setScalar(1.4); g.position.copy(at);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(g); propLOD.track(g);
    this.group = g;
  }
}

export class DiscoLights {
  constructor(scene, center) {
    this.center = center.clone();
    this.beams = [0xff2a6d, 0x05d9e8, 0xf9f871, 0x9d4edd].map((c, i) => {
      const l = new THREE.SpotLight(c, 0, 50, 0.22, 0.4, 1.1);
      l.position.copy(center).add(new THREE.Vector3(Math.cos(i * 1.57) * 8, 14, Math.sin(i * 1.57) * 6 + 4));
      scene.add(l, l.target);
      return l;
    });
    this.on = false; this.t = 0; this.flash = 0;
  }
  start() { this.on = true; }
  stop() { this.on = false; this.beams.forEach((b) => (b.intensity = 0)); }
  update(dt) {
    if (!this.on) return 0;
    this.t += dt;
    this.beams.forEach((b, i) => {
      const a = this.t * (0.9 + i * 0.25) + i * 1.6;
      b.target.position.copy(this.center).add(new THREE.Vector3(Math.cos(a) * 4.5, 0, Math.sin(a * 1.3) * 3.5 + 1));
      b.intensity = 500 + 300 * Math.sin(this.t * 7 + i);
    });
    // a strobe hit on every beat (~2 Hz)
    const beat = (this.t * 2) % 1;
    this.flash = beat < 0.12 ? 1 : 0;
    this.beams[0].intensity += this.flash * 1500;
    return this.flash;
  }
}

export class Confetti {
  constructor(scene) {
    const N = this.N = 900;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3); this.life = new Float32Array(N);
    this.spin = new Float32Array(N);
    const colors = new Float32Array(N * 3), pal = [0xff2a6d, 0x05d9e8, 0xf9f871, 0xffffff, 0x3a86ff, 0xff9f1c].map((c) => new THREE.Color(c));
    for (let i = 0; i < N; i++) pal[i % pal.length].toArray(colors, i * 3);
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.09, 0.06), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), N);
    for (let i = 0; i < N; i++) this.mesh.setColorAt(i, new THREE.Color().fromArray(colors, i * 3));
    this.mesh.count = 0; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.s = new THREE.Vector3(1, 1, 1);
    this.floorY = 0;
  }
  /** drop confetti over a circle */
  drop(center, radius = 7, height = 16, n = 900) {
    for (let i = 0; i < Math.min(n, this.N); i++) {
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * radius;
      this.pos.set([center.x + Math.cos(a) * r, height + Math.random() * 6, center.z + Math.sin(a) * r], i * 3);
      this.vel.set([0, -(0.7 + Math.random() * 0.6), 0], i * 3);
      this.life[i] = 25 + Math.random() * 10; this.spin[i] = Math.random() * 6;
    }
    this.mesh.count = Math.min(n, this.N);
    this.t = 0;
  }
  /** advance; returns how many pieces landed on the host this frame (near `hostPts`) */
  update(dt, hostPts = []) {
    if (!this.mesh.count) return 0;
    this.t = (this.t || 0) + dt;
    let touched = 0, alive = 0;
    for (let i = 0; i < this.mesh.count; i++) {
      const o = i * 3;
      if (this.life[i] <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(i, this.m); continue; }
      this.life[i] -= dt; alive++;
      const y = this.pos[o + 1];
      if (y > this.floorY + 0.02) {
        this.pos[o] += (Math.sin(this.t * 2 + i) * 0.35) * dt;           // flutter
        this.pos[o + 1] += this.vel[o + 1] * dt;
        this.pos[o + 2] += (Math.cos(this.t * 1.7 + i * 0.7) * 0.3) * dt;
        this.spin[i] += dt * 5;
        for (const h of hostPts) {
          const dx = this.pos[o] - h.x, dy = this.pos[o + 1] - h.y, dz = this.pos[o + 2] - h.z;
          if (dx * dx + dy * dy + dz * dz < 0.36) { touched++; this.pos[o + 1] = this.floorY + 0.01; break; }   // lands on him, slides off
        }
      } else this.pos[o + 1] = this.floorY + 0.01;
      const flat = this.pos[o + 1] <= this.floorY + 0.02;
      this.e.set(flat ? -Math.PI / 2 : this.spin[i], flat ? 0 : this.spin[i] * 0.7, i);
      this.q.setFromEuler(this.e);
      this.m.compose(new THREE.Vector3(this.pos[o], this.pos[o + 1], this.pos[o + 2]), this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) this.mesh.count = 0;
    return touched;
  }
  clear() { this.life.fill(0); this.mesh.count = 0; }
}

export class Balloons {
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.geo = new THREE.SphereGeometry(0.35, 12, 10).scale(1, 1.18, 1);
    this.stringGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.9, 3).translate(0, -0.85, 0);
    keep(this.geo); keep(this.stringGeo);
    this.floorY = 0;
  }
  drop(center, n = 26) {
    const cols = [0xd62828, 0xf1faee, 0x1d3557, 0xd62828, 0x457b9d];
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color: cols[i % cols.length], roughness: 0.25, metalness: 0.1 })));
      g.add(new THREE.Mesh(this.stringGeo, new THREE.MeshBasicMaterial({ color: 0xdddddd })));
      const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * 7;
      g.position.set(center.x + Math.cos(a) * r, 17 + Math.random() * 5, center.z + Math.sin(a) * r);
      this.scene.add(g); propLOD.track(g, { minTris: 100 });
      this.list.push({ g, vy: -(0.8 + Math.random() * 0.5), t: Math.random() * 6, life: 30 + Math.random() * 10 });
    }
  }
  update(dt) {
    for (const b of this.list) {
      b.t += dt; b.life -= dt;
      const bottom = this.floorY + 0.42;
      if (b.g.position.y > bottom) b.g.position.y += b.vy * dt;
      else { b.g.position.y = bottom + Math.abs(Math.sin(b.t * 2.5)) * 0.08; }
      b.g.position.x += Math.sin(b.t * 0.9) * 0.2 * dt;
      b.g.rotation.z = Math.sin(b.t * 1.3) * 0.15;
      if (b.life <= 0) disposeObject(b.g);
    }
    this.list = this.list.filter((b) => b.life > 0);
  }
  clear() { for (const b of this.list) disposeObject(b.g); this.list = []; }
}

export class Ufo {
  constructor(scene) {
    const g = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.85, roughness: 0.25 });
    g.add(new THREE.Mesh(new THREE.SphereGeometry(2.6, 28, 12).scale(1, 0.24, 1), hull));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(1.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.35, 0),
      new THREE.MeshStandardMaterial({ color: 0x7fe0c8, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.65, emissive: 0x1a5a4a })));
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.25, 0.35, 20).translate(0, -0.55, 0), hull));
    this.lamps = Array.from({ length: 12 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshStandardMaterial({ color: 0x222222, emissive: [0xff3355, 0x33ff99, 0x3399ff][i % 3], emissiveIntensity: 2 }));
      m.position.set(Math.cos(i / 12 * 6.28) * 2.45, -0.05, Math.sin(i / 12 * 6.28) * 2.45); g.add(m); return m;
    });
    // tractor beam: additive open cone + a real light
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xa8ffe8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 2.6, 1, 24, 1, true).translate(0, -0.5, 0), this.beamMat);
    this.beam.position.y = -0.6; g.add(this.beam);
    this.light = new THREE.SpotLight(0xb8fff0, 0, 40, 0.35, 0.5, 1); this.light.position.set(0, -0.6, 0);
    g.add(this.light, this.light.target); this.light.target.position.set(0, -20, 0);
    g.visible = false;
    scene.add(g); propLOD.track(g);
    this.g = g; this.state = 'off'; this.t = 0; this.beamLevel = 0;
  }

  /** come down over `getTarget()` and hover at `hoverY`; beam from t=beamAt for beamDur seconds */
  arrive(getTarget, { hoverY, beamAt = 3, beamDur = 8 } = {}) {
    this.getTarget = getTarget; this.hoverY = hoverY;
    const p = getTarget();
    this.g.position.set(p.x + 20, hoverY + 18, p.z - 10);
    this.g.visible = true; this.state = 'arrive'; this.t = 0; this.beamAt = beamAt; this.beamDur = beamDur;
  }

  get beamOn() { return this.beamLevel > 0.3; }

  /** is p inside the beam? returns 0..1 (1 on the axis) */
  inBeam(p) {
    if (this.beamLevel < 0.05) return 0;
    const c = this.g.position, r = Math.hypot(p.x - c.x, p.z - c.z);
    if (p.y > c.y) return 0;
    return Math.max(0, 1 - r / 2.4) * this.beamLevel;
  }

  update(dt) {
    if (this.state === 'off') return;
    this.t += dt;
    const g = this.g, tgt = this.getTarget();
    this.lamps.forEach((m, i) => (m.material.emissiveIntensity = 1 + 2 * Math.max(0, Math.sin(this.t * 8 - i * 0.8))));
    g.rotation.y += dt * 1.2;
    let beamWant = 0;
    if (this.state === 'arrive' || this.state === 'hover') {
      const want = new THREE.Vector3(tgt.x, this.hoverY + 0.25 * Math.sin(this.t * 2), tgt.z);
      g.position.lerp(want, Math.min(1, dt * (this.state === 'arrive' ? 0.9 : 1.6)));
      if (this.state === 'arrive' && g.position.distanceTo(want) < 1.2) { this.state = 'hover'; this.t = 0; }
      if (this.state === 'hover') {
        if (this.t > this.beamAt && this.t < this.beamAt + this.beamDur) beamWant = 1;
        if (this.t > this.beamAt + this.beamDur + 1) { this.state = 'leave'; this.t = 0; }
      }
    } else if (this.state === 'leave') {
      g.position.y += dt * (2 + this.t * 4);
      g.position.x -= dt * this.t * 6;
      if (this.t > 5) { this.state = 'off'; g.visible = false; }
    }
    this.beamLevel += (beamWant - this.beamLevel) * Math.min(1, dt * 3);
    const h = Math.max(1, g.position.y - (tgt.y - 0.2));
    this.beam.scale.set(1, h, 1);
    this.beamMat.opacity = 0.28 * this.beamLevel * (0.85 + 0.15 * Math.sin(this.t * 20));
    this.light.intensity = 1400 * this.beamLevel;
  }

  clear() { this.state = 'off'; this.g.visible = false; this.beamLevel = 0; this.light.intensity = 0; }
}

export { v3 };
