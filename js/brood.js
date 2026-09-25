// Eggs and hatchlings. Every time Leno reaches a new surface (floor, a platform step, the platform top, or a
// landing after flight) there is a chance (default 5%) that he lays a Drosophila-style egg from his rear. After a
// while it wobbles and hatches into a mini Leno - randomly a small humanoid Leno or a small Fly-Leno - which
// wanders about in fly-like bouts, keeps loosely near its parent and chirps in a sped-up Leno voice.
// Hatchlings run on simple autonomous behaviour; only the host is driven by the fly brain.
import * as THREE from 'three';
import { keep, disposeObject } from './dispose.js';
import { Leno } from './leno.js';
import { FlyLeno } from './flybody.js';

const MAX_YOUNG = 16, MAX_EGGS = 8;
const down = new THREE.Vector3(0, -1, 0);

function eggGeometry() {
  // white elongated egg with the two dorsal respiratory filaments
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f0e2, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10).scale(1, 1, 2.2), mat);
  body.position.y = 0.1; g.add(body);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.28, 5).translate(0, 0.14, 0), mat);
    f.position.set(0.03 * s, 0.17, 0.17); f.rotation.set(0.9, 0, 0.25 * s); g.add(f);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Brood {
  constructor({ scene, stage, lenoScene, audio, onEvent }) {
    Object.assign(this, { scene, stage, lenoScene, audio, onEvent });
    keep(lenoScene);                                  // humanoid hatchlings are skinned clones sharing its geometry
    this.chance = 0.05;
    this.eggs = []; this.young = [];
    this.ray = new THREE.Raycaster();
    this.surface = null; this.checkT = 0; this.wasFlying = false;
    this.grounds = stage.ground;
    this.center = new THREE.Vector3().fromArray(stage.markers.stageCenter.position);
  }

  surfaceUnder(p) {
    this.ray.set(new THREE.Vector3(p.x, p.y + 1.5, p.z), down); this.ray.far = 4;
    const hit = this.ray.intersectObjects(this.grounds, false)[0];
    return hit ? { id: hit.object.uuid + ':' + Math.round(hit.point.y * 4), y: hit.point.y } : null;
  }

  /** watch the host: new surface / landing -> maybe lay an egg */
  watch(dt, host) {
    this.checkT += dt;
    const landed = this.wasFlying && !host.flying;
    this.wasFlying = !!host.flying;
    if (this.checkT < 0.3 && !landed) return;
    this.checkT = 0;
    const pos = host.position ?? host.root.position;
    const s = this.surfaceUnder(pos);
    if (!s || host.flying) return;
    const isNew = s.id !== this.surface?.id;
    if (this.surface && (isNew || landed) && Math.random() < this.chance) this.lay(host, s.y);
    if (isNew) this.surface = s;
  }

  lay(host, groundY) {
    if (this.eggs.length >= MAX_EGGS) return;
    host.trigger?.('lay');
    setTimeout(() => {
      const p = host.butt().clone(); const sy = this.surfaceUnder(p)?.y ?? groundY; p.y = sy;
      const mesh = eggGeometry(); mesh.position.copy(p); mesh.rotation.y = Math.random() * 6.28;
      mesh.scale.setScalar(1.25); this.scene.add(mesh);
      this.eggs.push({ mesh, t: 0, hatchAt: 12 + Math.random() * 10, pos: p, parent: host });
      this.audio.sfx('splat', { gain: 0.25 });
      this.onEvent?.('lay');
    }, 900);
  }

  async hatch(egg) {
    disposeObject(egg.mesh);
    this.onEvent?.('hatch');
    if (this.young.length >= MAX_YOUNG) return;
    const fly = Math.random() < 0.5;
    const yaw = Math.random() * 6.28;
    let body;
    if (fly) {
      body = await new FlyLeno(this.scene, { scale: 0.32, mini: true, ground: this.grounds }).load();
      body.placeMini(egg.pos.clone(), yaw);
    } else {
      body = new Leno({ scale: 0.45, minY: -Infinity }).fromScene(this.lenoScene);
      this.scene.add(body.root);
      body.ground = this.grounds;
      body.root.position.copy(egg.pos); body.root.rotation.y = yaw;
    }
    // chirp: a Leno mutter, sped up
    const m = this.audio.bank?.leno?.mutters;
    if (m?.length) this.audio.playClip(m[(Math.random() * m.length) | 0], { rate: 1.7 + Math.random() * 0.3, gain: 0.6 });
    this.young.push({ kind: fly ? 'fly' : 'leno', body, home: egg.pos.clone(), parent: egg.parent, target: null, wait: 0.5, t: 0, chirpT: 3 + Math.random() * 8,
      life: 180 + Math.random() * 120 });
  }

  update(dt, host) {
    if (!dt) return;
    this.watch(dt, host);
    for (const e of [...this.eggs]) {
      e.t += dt;
      const left = e.hatchAt - e.t;
      if (left < 3) e.mesh.rotation.z = Math.sin(e.t * (left < 1 ? 40 : 18)) * 0.15 * (1 - left / 3);   // wobble
      if (e.t >= e.hatchAt) { this.eggs.splice(this.eggs.indexOf(e), 1); this.hatch(e); }
    }
    for (const y of this.young) this.think(dt, y, host);
    // grown up: after a few minutes a hatchling leaves the show, and is freed once it's gone
    for (const y of [...this.young]) {
      y.life -= dt;
      if (y.life <= 0 && !y.leaving) this.leave(y);
      if (y.gone) { disposeObject(y.body.root); this.young.splice(this.young.indexOf(y), 1); this.onEvent?.('leave'); }
    }
  }

  /** a fly-form hatchling takes off and flies up and away from the stage; a humanoid one walks off into the nearer
   *  wing (where the stagehands come on) */
  leave(y) {
    y.leaving = true; y.leaveT = 0;
    const pos = y.kind === 'fly' ? y.body.pos : y.body.root.position;
    if (y.kind === 'fly') {
      const out = pos.clone().sub(this.center).setY(0);
      if (out.lengthSq() < 0.01) out.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      out.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.2);
      y.exit = pos.clone().addScaledVector(out, 40);
      y.body.away = true;
    } else {
      const side = pos.x >= this.center.x ? 1 : -1;
      y.exit = this.center.clone().add(new THREE.Vector3(side * 12, 0, -4));
    }
    this.onEvent?.('leaving', { kind: y.kind });
  }

  exit(dt, y) {
    const b = y.body, pos = y.kind === 'fly' ? b.pos : b.root.position;
    y.leaveT += dt;
    const fwd = b.forward(), to = y.exit.clone().sub(pos).setY(0);
    const ang = Math.atan2(fwd.z * to.x - fwd.x * to.z, fwd.x * to.x + fwd.z * to.z);
    const walk = y.kind === 'fly' ? 0 : Math.abs(ang) < 0.6 ? 1.4 : 0.2;
    b.setMotor({ forward: walk, backward: 0, turn: Math.max(-1, Math.min(1, ang * 2)), startle: 0, groom: 0, feed: 0 });
    this.step(dt, y);
    // gone: out of sight up in the rafters, or through the wing (or given up on, if something is in the way)
    y.gone = y.kind === 'fly' ? b.altitude > 8 || y.leaveT > 12 : to.length() < 0.6 || y.leaveT > 60;
  }

  think(dt, y, host) {
    if (y.leaving) { this.exit(dt, y); return; }
    y.t += dt;
    const b = y.body;
    const pos = y.kind === 'fly' ? b.pos : b.root.position;
    const parentPos = host.position ?? host.root?.position;
    // pick a target: somewhere near home, or back toward the parent if it's far
    if (!y.target || pos.distanceTo(y.target) < 0.5) {
      y.wait -= dt;
      if (y.wait > 0) { b.setMotor({ forward: 0, turn: 0 }); this.step(dt, y); return; }
      const nearParent = parentPos && pos.distanceTo(parentPos) > 10;
      const c = nearParent ? parentPos : y.home;
      const a = Math.random() * 6.28, r = 1.5 + Math.random() * 5;
      y.target = new THREE.Vector3(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
      y.wait = 0.8 + Math.random() * 2.5;
      if (y.kind === 'fly' && Math.random() < 0.25) { b.flying = true; y.flyUntil = y.t + 0.8 + Math.random(); }
    }
    if (y.kind === 'fly' && b.flying && y.t > (y.flyUntil ?? 0)) b.flying = false;
    // steer: pivot then walk (like the host's food homing)
    const fwd = b.forward(), to = y.target.clone().sub(pos).setY(0);
    const ang = Math.atan2(fwd.z * to.x - fwd.x * to.z, fwd.x * to.x + fwd.z * to.z);
    const walk = Math.abs(ang) < 0.5 ? 0.8 : 0;
    b.setMotor({ forward: walk, backward: 0, turn: Math.max(-1, Math.min(1, ang * 2)), startle: 0, groom: 0, feed: 0 });
    y.chirpT -= dt;
    if (y.chirpT <= 0) {
      y.chirpT = 6 + Math.random() * 12;
      const m = this.audio.bank?.leno?.phonemes;
      const keys = m ? Object.keys(m) : [];
      if (keys.length) { const clips = m[keys[(Math.random() * keys.length) | 0]]; this.audio.playClip(clips[(Math.random() * clips.length) | 0], { rate: 1.8, gain: 0.35 }); }
    }
    this.step(dt, y);
  }

  step(dt, y) { if (y.kind === 'fly') y.body.updateMini(dt); else y.body.update(dt); }

  clear() {
    for (const e of this.eggs) disposeObject(e.mesh);
    for (const y of this.young) disposeObject(y.body.root);
    this.eggs = []; this.young = []; this.surface = null;
  }
}
