// The studio audience: low-poly hooded, robed figures in white theatre masks (js/cultist-model.js), one per
// audience seat marker, drawn as two InstancedMeshes (body, head) so the heads can follow Leno.
// They bob with applause/cheers, rock with laughter, sway and shake their fists at boos, and one of them
// occasionally stands up to throw something.
import * as THREE from 'three';
import { seatedGeometry, figureMaterial, NECK, FIGURE_SCALE as SCALE } from './cultist-model.js';

export class Cultists {
  constructor(scene, audienceMarkers) {
    this.seats = audienceMarkers.map((a) => {
      const p = new THREE.Vector3().fromArray(a.position);
      const f = a.toHost ? new THREE.Vector3().fromArray(a.toHost) : new THREE.Vector3(0, 0, -1);
      return { p, yaw: Math.atan2(f.x, f.z), phase: Math.random() * 6.28, rate: 0.8 + Math.random() * 0.5, stand: 0, energy: 0 };
    });
    const mat = figureMaterial();
    const geo = seatedGeometry();
    this.mesh = new THREE.InstancedMesh(geo.body, mat, this.seats.length);
    this.heads = new THREE.InstancedMesh(geo.head, mat, this.seats.length);
    for (const m of [this.mesh, this.heads]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); }
    this.mesh.name = 'Cultists'; this.heads.name = 'CultistHeads';
    this.target = null;                      // THREE.Vector3 the heads look at (Leno's head)
    for (const s of this.seats) { s.hy = 0; s.hp = 0; }
    this._hm = new THREE.Matrix4(); this._hq = new THREE.Quaternion(); this._neck = NECK.clone().multiplyScalar(SCALE);
    this.mood = { kind: null, level: 0 };   // current crowd reaction and its strength (decays)
    this.hidden = new Set();                 // seats whose occupant is up and walking (e.g. a heckler)
    this._zero = new THREE.Vector3(0, 0, 0);
    this.seatHeight = 0.45;                  // seat surface above the marker, before bobbing
    this.t = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1);
    this.update(0);
  }

  /** a crowd reaction: 'cheer' | 'applause' | 'laugh' | 'boo' | 'gasp' */
  react(kind, intensity = 1) {
    this.mood = { kind, level: Math.min(1.5, 0.6 + intensity) };
    for (const s of this.seats) s.energy = Math.random() < 0.85 ? 0.6 + Math.random() * 0.6 : 0;   // a few don't care
  }

  setHidden(i, on) { if (on) this.hidden.add(i); else this.hidden.delete(i); }

  /** a random cultist stands up (to throw); returns the throw origin */
  standRandom() {
    const s = this.seats[(Math.random() * this.seats.length) | 0];
    s.stand = 1;
    return s.p.clone().add(new THREE.Vector3(0, (this.seatHeight + 1.2) * SCALE, 0));
  }

  update(dt) {
    this.t += dt;
    const m = this.mood;
    m.level = Math.max(0, m.level - dt * 0.35);
    const { _m, _q, _e, _s } = this;
    this.seats.forEach((s, i) => {
      s.stand = Math.max(0, s.stand - dt * 0.7);
      const e = s.energy * m.level;
      let y = 0, pitch = 0, roll = 0;
      const ph = this.t * s.rate + s.phase;
      switch (m.kind) {
        case 'cheer': case 'applause': y = e * 0.18 * Math.abs(Math.sin(ph * 7)); break;            // bouncing
        case 'laugh': y = e * 0.06 * Math.abs(Math.sin(ph * 11)); pitch = e * 0.25 * Math.sin(ph * 5.5); break; // rocking
        case 'boo': y = e * 0.05 * Math.sin(ph * 3); roll = e * 0.18 * Math.sin(ph * 3.5); break;   // swaying
        case 'gasp': pitch = -e * 0.3; y = e * 0.05; break;                                            // recoil
      }
      y += 0.008 * Math.sin(this.t * 1.3 + s.phase);                                                   // breathing
      y += s.stand * 0.45 * SCALE;                                                                    // standing to throw
      _e.set(pitch, s.yaw, roll, 'YXZ');
      _q.setFromEuler(_e);
      const base = new THREE.Vector3(s.p.x, s.p.y + this.seatHeight * SCALE + y, s.p.z);
      const sc = this.hidden.has(i) ? this._zero : _s;
      _m.compose(base, _q, sc);
      this.mesh.setMatrixAt(i, _m);
      // head: turn toward Leno (relative to the body), limited like a neck, smoothed
      let ty = 0, tp = 0;
      if (this.target) {
        const neckW = this._neck.clone().applyQuaternion(_q).add(base);
        const d = this.target.clone().sub(neckW);
        let yaw = Math.atan2(d.x, d.z) - s.yaw;
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        ty = THREE.MathUtils.clamp(yaw, -1.3, 1.3);
        tp = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.6, 0.6);
      }
      const k = Math.min(1, dt * (3 + (i % 5)));                  // not everyone turns at the same speed
      s.hy += (ty - s.hy) * k; s.hp += (tp - s.hp) * k;
      this._hq.setFromEuler(_e.set(s.hp, s.hy, 0, 'YXZ'));
      const hq = _q.clone().multiply(this._hq);
      this._hm.compose(this._neck.clone().applyQuaternion(_q).add(base), hq, sc);
      this.heads.setMatrixAt(i, this._hm);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
