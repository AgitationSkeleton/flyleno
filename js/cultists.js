// The studio audience: low-poly hooded, robed figures in white theatre masks (js/cultist-model.js), one per
// audience seat marker, drawn as InstancedMeshes (body, head) so the heads can follow Leno.
// Levels of detail by distance from the viewing camera: near = full model, mid = about half the segments,
// far = one merged piece with the head fixed. Each frame every seat is written into its level's instances.
// They bob with applause/cheers, rock with laughter, sway and shake their fists at boos, and one of them
// occasionally stands up to throw something.
import * as THREE from 'three';
import { seatedGeometry, farSeatedGeometry, figureMaterial, NECK, FIGURE_SCALE as SCALE } from './cultist-model.js';

const LOD_DIST = [16, 32];                 // metres: near < 16 <= mid < 32 <= far (with 10% hysteresis)

export class Cultists {
  constructor(scene, audienceMarkers) {
    this.seats = audienceMarkers.map((a) => {
      const p = new THREE.Vector3().fromArray(a.position);
      const f = a.toHost ? new THREE.Vector3().fromArray(a.toHost) : new THREE.Vector3(0, 0, -1);
      return { p, yaw: Math.atan2(f.x, f.z), phase: Math.random() * 6.28, rate: 0.8 + Math.random() * 0.5, stand: 0, energy: 0 };
    });
    const mat = figureMaterial(), n = this.seats.length;
    const inst = (geo, name) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.name = name; m.count = 0;
      scene.add(m); return m;
    };
    const near = seatedGeometry(), mid = seatedGeometry(undefined, 0.5);
    this.levels = [
      { body: inst(near.body, 'Cultists'), head: inst(near.head, 'CultistHeads') },
      { body: inst(mid.body, 'CultistsMid'), head: inst(mid.head, 'CultistHeadsMid') },
      { body: inst(farSeatedGeometry(), 'CultistsFar'), head: null },
    ];
    this.mesh = this.levels[0].body; this.heads = this.levels[0].head;
    this.eye = null;                         // camera position for LOD (set by the app); null = all near
    for (const s of this.seats) { s.lod = 0; s.age = 1; s.rise = 0; s.spin = 0; s.gone = false; }
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

  /** a stadium wave: a band of people standing up sweeps across the seats `laps` times (smoothly, ~3 s a sweep) */
  wave(laps = 3, period = 3.2) {
    if (!this.waveU) {
      // each seat's place across the audience, 0..1 along its widest horizontal extent
      const box = new THREE.Box3(); for (const s of this.seats) box.expandByPoint(s.p);
      const size = box.getSize(new THREE.Vector3()), ax = size.x >= size.z ? 'x' : 'z';
      this.waveU = this.seats.map((s) => (s.p[ax] - box.min[ax]) / Math.max(1e-3, size[ax]));
    }
    this.waveT = 0; this.waveDur = laps * period; this.wavePeriod = period;
  }

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
    if (this.ovation > 0) {                                      // standing ovation: everyone up, clapping
      this.ovation -= dt;
      for (const s of this.seats) s.stand = 1;
      if (m.level < 0.8) this.react('applause', 1);
    }
    if (this.waveT !== undefined && this.waveT < this.waveDur) {
      this.waveT += dt;
      const front = ((this.waveT / this.wavePeriod) % 1) * 1.3 - 0.15;
      this.seats.forEach((s, i) => { const d = (this.waveU[i] - front) / 0.08; s.stand = Math.max(s.stand, Math.exp(-d * d)); });
    }
    const { _m, _q, _e, _s } = this;
    const counts = [0, 0, 0];
    this.seats.forEach((s, i) => {
      if (this.hidden.has(i) || s.gone) return;                    // up and walking (a heckler), or raptured
      // level of detail from the camera distance, with hysteresis so seats don't flicker between levels
      if (this.eye) {
        const d = s.p.distanceTo(this.eye);
        while (s.lod < 2 && d > LOD_DIST[s.lod] * 1.1) s.lod++;
        while (s.lod > 0 && d < LOD_DIST[s.lod - 1] * 0.9) s.lod--;
      } else s.lod = 0;
      const L = this.levels[s.lod], slot = counts[s.lod]++;
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
      y += s.rise;                                                                                    // ascending (the Rapture)
      // age 0 (newborn) .. 1 (adult): babies are small with big heads, standing up on their seats and bouncing
      const bs = 0.5 + 0.5 * s.age, hs = 0.82 + 0.18 * s.age, young = 1 - s.age;
      y += young * (0.55 + 0.08 * Math.abs(Math.sin(this.t * 6 + s.phase)));
      _e.set(pitch, s.yaw + s.spin, roll, 'YXZ');
      _q.setFromEuler(_e);
      const base = new THREE.Vector3(s.p.x, s.p.y + this.seatHeight * SCALE + y, s.p.z);
      const sc = _s.set(bs, bs, bs);
      _m.compose(base, _q, sc);
      L.body.setMatrixAt(slot, _m);
      if (!L.head) return;                                          // far: head merged into the body, fixed
      // head: turn toward Leno (relative to the body), limited like a neck, smoothed
      let ty = 0, tp = 0;
      if (this.target) {
        const neckW = this._neck.clone().multiplyScalar(bs).applyQuaternion(_q).add(base);
        const d = this.target.clone().sub(neckW);
        let yaw = Math.atan2(d.x, d.z) - s.yaw;
        yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
        ty = THREE.MathUtils.clamp(yaw, -0.9, 0.9);                              // neck-like limits, so the head stays
        tp = THREE.MathUtils.clamp(-Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.35, 0.35);   // seated in its collar
      }
      const k = Math.min(1, dt * (3 + (i % 5)));                  // not everyone turns at the same speed
      s.hy += (ty - s.hy) * k; s.hp += (tp - s.hp) * k;
      this._hq.setFromEuler(_e.set(s.hp, s.hy, 0, 'YXZ'));
      const hq = _q.clone().multiply(this._hq);
      this._hm.compose(this._neck.clone().multiplyScalar(bs).applyQuaternion(_q).add(base), hq, _s.set(hs, hs, hs));
      L.head.setMatrixAt(slot, this._hm);
    });
    this.levels.forEach((L, k) => {
      for (const m of [L.body, L.head]) { if (!m) continue; m.count = counts[k]; m.instanceMatrix.needsUpdate = true; }
    });
    this.lodCounts = counts;
  }
}
