// The studio audience: low-poly robed, white-masked cultists (an original model evoking the cloaked
// figures of Nightmare Puppeteer's soundstage), one per audience seat marker, drawn as one InstancedMesh.
// They bob with applause/cheers, rock with laughter, sway and shake their fists at boos, and one of them
// occasionally stands up to throw something.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const SCALE = 1.35;                         // match Leno / the 1.4x set

function colored(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo.index ? geo.toNonIndexed() : geo;
}

const NECK = new THREE.Vector3(0, 0.72, 0);   // head pivot (before SCALE)

/** Seated cultist, origin at the seat surface centre, facing +Z. ~1.0 m tall seated before SCALE.
 *  Returns { body, head }; the head is modelled around the neck pivot so it can turn. */
export function cultistGeometry() {
  const BLACK = 0x121214, CLOAK = 0x1b1a20, TRIM = 0x2a2830, MASK = 0xeeeae2, EYE = 0x050505;
  const parts = [];
  // torso/robe: a tapered 7-sided column
  parts.push(colored(new THREE.CylinderGeometry(0.16, 0.3, 0.62, 7, 1).translate(0, 0.31, -0.02), CLOAK));
  // lap and knees (seated): a slab forward, then the robe falling to the floor
  parts.push(colored(new THREE.BoxGeometry(0.46, 0.14, 0.42).translate(0, 0.02, 0.2), CLOAK));
  parts.push(colored(new THREE.CylinderGeometry(0.22, 0.27, 0.45, 7, 1).translate(0, -0.2, 0.36), BLACK));
  // shoulders / cape
  parts.push(colored(new THREE.ConeGeometry(0.32, 0.3, 7, 1, true).translate(0, 0.66, 0), TRIM));
  const head = [];
  // hood: pointed, slightly forward
  head.push(colored(new THREE.ConeGeometry(0.2, 0.52, 7, 1).translate(0, 0.98, -0.02), BLACK));
  head.push(colored(new THREE.SphereGeometry(0.19, 7, 5).scale(1, 1.15, 1).translate(0, 0.84, 0), BLACK));
  // white mask (flattened, slightly pointed chin) inside the hood opening
  head.push(colored(new THREE.SphereGeometry(0.13, 8, 6).scale(0.95, 1.3, 0.42).translate(0, 0.83, 0.13), MASK));
  // eye slits and mouth hole
  for (const x of [-0.05, 0.05]) head.push(colored(new THREE.BoxGeometry(0.05, 0.018, 0.03).translate(x, 0.87, 0.185), EYE));
  head.push(colored(new THREE.BoxGeometry(0.035, 0.02, 0.03).translate(0, 0.76, 0.18), EYE));
  // sleeves resting on the lap, pale hands
  for (const s of [-1, 1]) {
    parts.push(colored(new THREE.CylinderGeometry(0.06, 0.09, 0.42, 6, 1).rotateX(Math.PI / 2.6).translate(0.2 * s, 0.3, 0.12), CLOAK));
    parts.push(colored(new THREE.SphereGeometry(0.05, 5, 4).translate(0.19 * s, 0.14, 0.3), MASK));
  }
  const body = mergeGeometries(parts).scale(SCALE, SCALE, SCALE);
  const h = mergeGeometries(head).translate(-NECK.x, -NECK.y, -NECK.z).scale(SCALE, SCALE, SCALE);
  body.computeVertexNormals(); h.computeVertexNormals();
  return { body, head: h };
}

export class Cultists {
  constructor(scene, audienceMarkers) {
    this.seats = audienceMarkers.map((a) => {
      const p = new THREE.Vector3().fromArray(a.position);
      const f = a.toHost ? new THREE.Vector3().fromArray(a.toHost) : new THREE.Vector3(0, 0, -1);
      return { p, yaw: Math.atan2(f.x, f.z), phase: Math.random() * 6.28, rate: 0.8 + Math.random() * 0.5, stand: 0, energy: 0 };
    });
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.0 });
    const geo = cultistGeometry();
    this.mesh = new THREE.InstancedMesh(geo.body, mat, this.seats.length);
    this.heads = new THREE.InstancedMesh(geo.head, mat, this.seats.length);
    for (const m of [this.mesh, this.heads]) { m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; scene.add(m); }
    this.mesh.name = 'Cultists'; this.heads.name = 'CultistHeads';
    this.target = null;                      // THREE.Vector3 the heads look at (Leno's head)
    for (const s of this.seats) { s.hy = 0; s.hp = 0; }
    this._hm = new THREE.Matrix4(); this._hq = new THREE.Quaternion(); this._neck = NECK.clone().multiplyScalar(SCALE);
    this.mood = { kind: null, level: 0 };   // current crowd reaction and its strength (decays)
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
      _m.compose(base, _q, _s);
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
      this._hm.compose(this._neck.clone().applyQuaternion(_q).add(base), hq, _s);
      this.heads.setMatrixAt(i, this._hm);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
