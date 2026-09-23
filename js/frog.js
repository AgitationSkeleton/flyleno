// Mr. Frog, tonight's guest ("Give it up for Mr. Frog!"). A low-poly frog that hops on from the wings,
// sits across from Leno, and answers every question with "Good. Good. Good." (croaks).
// He is also a fly's natural predator: now and then he flicks his tongue at the host. For the fly that is
// a looming object (LC4) and a hit on the body (mechanosensory), and Fly-Leno can get caught and spat out.
// He leaves when his segment is over, when Leno bites his ankles ("I'll inch my way over and bite your
// ankles"), or when Leno yells at him ("You're out of here, Mr. Frog!").
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propLOD } from './lod.js';

const S = 1.9;                                     // guest-sized: about Leno's seated height

function col(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}

function frogModel() {
  const GREEN = 0x4f8f2c, DARK = 0x2f5e1c, BELLY = 0xd8d98a, EYE = 0xf4f1d0, PUPIL = 0x0b0b0b, SPOT = 0x2c4a17;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05 });
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  body.add(new THREE.Mesh(mergeGeometries([
    col(new THREE.IcosahedronGeometry(0.3, 1).scale(1.05, 0.7, 1.2).rotateX(-0.45).translate(0, 0.3, 0), GREEN),          // body, sitting up
    col(new THREE.IcosahedronGeometry(0.22, 1).scale(1, 0.62, 0.95).rotateX(-0.45).translate(0, 0.27, 0.09), BELLY),      // belly
    col(new THREE.IcosahedronGeometry(0.06, 0).translate(0.13, 0.44, -0.2), SPOT), col(new THREE.IcosahedronGeometry(0.05, 0).translate(-0.1, 0.36, -0.28), SPOT),
    // back legs folded at the sides, big webbed feet
    ...[-1, 1].flatMap((s) => [
      col(new THREE.IcosahedronGeometry(0.14, 0).scale(0.7, 0.6, 1.5).translate(0.26 * s, 0.14, -0.05), DARK),
      col(new THREE.IcosahedronGeometry(0.1, 0).scale(0.6, 0.4, 1.3).translate(0.3 * s, 0.07, 0.14), GREEN),
      col(new THREE.ConeGeometry(0.1, 0.03, 4).rotateY(Math.PI / 4).scale(1.2, 1, 1.6).translate(0.3 * s, 0.015, 0.28), DARK),
      // front legs
      col(new THREE.CylinderGeometry(0.035, 0.03, 0.26, 5).rotateX(0.25).translate(0.14 * s, 0.14, 0.2), GREEN),
      col(new THREE.ConeGeometry(0.06, 0.02, 4).translate(0.14 * s, 0.012, 0.26), DARK),
    ]),
  ]), mat));
  // head: wide, flat, with bulging eyes; mouth line; throat sac that inflates when he croaks
  const head = new THREE.Group(); head.position.set(0, 0.52, 0.1); body.add(head);
  head.add(new THREE.Mesh(mergeGeometries([
    col(new THREE.IcosahedronGeometry(0.2, 1).scale(1.25, 0.6, 1.05).translate(0, 0.02, 0.04), GREEN),
    col(new THREE.BoxGeometry(0.4, 0.012, 0.012).translate(0, -0.035, 0.2), PUPIL),                                      // mouth line
    ...[-1, 1].flatMap((s) => [
      col(new THREE.SphereGeometry(0.075, 8, 6).translate(0.13 * s, 0.1, 0.05), GREEN),
      col(new THREE.SphereGeometry(0.06, 8, 6).translate(0.135 * s, 0.115, 0.08), EYE),
      col(new THREE.SphereGeometry(0.028, 6, 4).scale(1, 1.5, 0.6).translate(0.14 * s, 0.12, 0.135), PUPIL),
    ]),
  ]), mat));
  const sac = new THREE.Mesh(col(new THREE.SphereGeometry(0.1, 8, 6), BELLY), mat);
  sac.position.set(0, -0.1, 0.13); head.add(sac);
  // the tongue: a pink strip along +Z from the mouth, scaled to reach its target, with a sticky tip
  const tongue = new THREE.Group(); tongue.position.set(0, -0.04, 0.18); head.add(tongue);
  const tmat = new THREE.MeshStandardMaterial({ color: 0xe0607a, roughness: 0.35 });
  const strip = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), tmat);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), tmat);
  tongue.add(strip, tip); tongue.visible = false;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(S);
  return { g, body, head, sac, tongue, strip, tip };
}

export class Frog {
  constructor({ scene, stage, sfx, onEvent }) {
    Object.assign(this, { scene, stage, sfx, onEvent });
    this.active = null;
    this.ray = new THREE.Raycaster();
    const c = stage.markers.stageCenter.position;
    this.center = new THREE.Vector3(c[0], c[1], c[2]);
  }

  groundAt(p) {
    this.ray.set(new THREE.Vector3(p.x, p.y + 3, p.z), new THREE.Vector3(0, -1, 0)); this.ray.far = 10;
    const hit = this.ray.intersectObjects(this.stage.ground, false)[0];
    return hit ? hit.point.y : p.y;
  }

  get present() { return !!this.active; }

  /** Mr. Frog hops on for `dur` seconds */
  enter(getHost, dur = 45) {
    if (this.active) return;
    const m = frogModel(), side = Math.random() < 0.5 ? -1 : 1;
    const start = this.center.clone().add(new THREE.Vector3(side * 12, 0, 1)); start.y = this.groundAt(start);
    m.g.position.copy(start); this.scene.add(m.g); propLOD.track(m.g);
    this.getHost = getHost;
    this.active = { ...m, state: 'enter', t: 0, until: dur, hop: null, croakT: 3, tongueT: 5 + Math.random() * 4, exit: start.clone(), strike: null, caught: false };
    this.onEvent?.('enter');
  }

  /** "You're out of here, Mr. Frog!" */
  leave(reason = 'done') {
    const A = this.active;
    if (!A || A.state === 'exit') return;
    A.state = 'exit'; A.hop = null; this.retract();
    this.onEvent?.('leave', { reason });
  }

  clear() { if (this.active) { this.scene.remove(this.active.g); this.active = null; } }

  headPos() { return this.active ? this.active.head.localToWorld(new THREE.Vector3(0, 0, 0.15)) : null; }
  tipPos() { return this.active?.tongue.visible ? this.active.tip.getWorldPosition(new THREE.Vector3()) : null; }

  hostTarget() {
    const h = this.getHost();
    return (h.state?.headPos ?? h.position).clone();
  }

  /** a guest seat across from Leno, facing him */
  seat() {
    const h = this.getHost().position ?? this.center;
    if (this.guestSpot && this.guestSpot.distanceTo(h) < 8 && this.guestSpot.distanceTo(h) > 2.5) {
      const p = this.guestSpot.clone(); p.y = this.groundAt(p); return p;
    }
    const away = this.center.clone().sub(h).setY(0);
    if (away.lengthSq() < 0.5) away.set(1, 0, 0.4);
    const p = h.clone().add(away.normalize().multiplyScalar(4.2)); p.y = this.groundAt(p);
    return p;
  }

  hopTo(target, len = 1.6) {
    const A = this.active, from = A.g.position.clone();
    const d = target.clone().sub(from).setY(0), dist = d.length();
    const step = Math.min(len, dist), to = from.clone().addScaledVector(d.normalize(), step);
    to.y = this.groundAt(to);
    A.hop = { from, to, t: 0, dur: 0.45 + step * 0.08, h: 0.45 + step * 0.25 };
    A.g.rotation.y = Math.atan2(d.x, d.z);
  }

  face(p) {
    const A = this.active, d = p.clone().sub(A.g.position);
    let dy = Math.atan2(d.x, d.z) - A.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    A.g.rotation.y += dy * 0.08;
  }

  /** flick the tongue at the host */
  strike() {
    const A = this.active;
    if (!A || A.strike) return;
    A.strike = { t: 0, hit: false };
    this.sfx.thwip({ gain: 0.8 });
    this.onEvent?.('tongue');
  }

  retract() { const A = this.active; if (A) { A.tongue.visible = false; A.strike = null; } }

  update(dt, { hostIsFly = false, hostMouthOpen = 0, voice = 0 } = {}) {
    const A = this.active;
    if (!A || !dt) return;
    A.t += dt;
    const g = A.g;
    // hopping
    if (A.hop) {
      const H = A.hop; H.t += dt; const u = Math.min(1, H.t / H.dur);
      g.position.lerpVectors(H.from, H.to, u); g.position.y += Math.sin(Math.PI * u) * H.h;
      A.body.rotation.x = -0.5 * Math.sin(Math.PI * u);
      if (u >= 1) { A.hop = null; A.body.rotation.x = 0; }
      return;
    }
    if (A.state === 'enter') {
      const seat = this.seat();
      if (seat.distanceTo(g.position) > 0.6) this.hopTo(seat);
      else { A.state = 'sit'; this.onEvent?.('seated'); }
      return;
    }
    if (A.state === 'exit') {
      if (A.exit.distanceTo(g.position) > 0.8) this.hopTo(A.exit, 2.2);
      else { this.clear(); this.onEvent?.('gone'); }
      return;
    }
    // sitting: face the host, breathe, croak, flick the tongue
    const target = this.hostTarget();
    this.face(target);
    A.body.scale.y = 1 + 0.03 * Math.sin(A.t * 3);
    A.croakT -= dt;
    if (A.croakT <= 0) {
      // "Good. Good. Good. Good..." : a run of croaks, throat sac pumping
      const n = 2 + ((Math.random() * 6) | 0);
      for (let k = 0; k < n; k++) setTimeout(() => { if (this.active === A) { this.sfx.croak({ gain: 0.75 }); A.puff = 0.45; } }, k * 520);
      A.croakT = n * 0.52 + 3 + Math.random() * 6;
      this.onEvent?.('croak', { n });
    }
    if (A.puff > 0) A.puff -= dt;
    const puff = A.puff > 0 ? Math.sin((0.45 - A.puff) / 0.45 * Math.PI) : 0;
    A.sac.scale.setScalar(1 + 1.6 * puff);
    // the tongue: out in 0.12 s, sticks 0.15 s, back in 0.2 s
    const tip = A.head.localToWorld(new THREE.Vector3(0, -0.04, 0.18));
    const reach = target.distanceTo(tip);
    A.tongueT -= dt * (hostIsFly ? 2.2 : 1);          // a fly-sized host is much more interesting
    if (!A.strike && A.tongueT <= 0 && reach < 6.5) { A.tongueT = 6 + Math.random() * 9; this.strike(); }
    if (A.strike) {
      const T = A.strike; T.t += dt;
      const out = T.t < 0.12 ? T.t / 0.12 : T.t < 0.27 ? 1 : Math.max(0, 1 - (T.t - 0.27) / 0.2);
      A.tongue.visible = out > 0.01;
      // aim at the host, in the tongue's parent (head) space
      const local = A.head.worldToLocal(target.clone()).sub(A.tongue.position);
      const L = local.length() * out;
      A.tongue.lookAt(A.head.localToWorld(A.tongue.position.clone().add(local)));
      A.strip.scale.set(1, 1, Math.max(0.01, L)); A.tip.position.set(0, 0, L);
      if (!T.hit && out >= 1) {
        T.hit = true;
        const caught = hostIsFly && Math.random() < 0.6;
        this.onEvent?.('hit', { caught });
        if (caught) A.caught = true;
      }
      if (T.t > 0.5) this.retract();
    }
    if (A.caught && !A.strike) { A.caught = false; setTimeout(() => this.onEvent?.('spit'), 700); }
    // Leno bites his ankles (mouth open or feeding, right next to him) or yells him off stage
    const close = (this.getHost().position ?? target).distanceTo(g.position);
    if (close < 1.6 * S / 1.9 && hostMouthOpen > 0.5) this.leave('bite');
    // yelling: a sustained loud stretch (the fly's voicing is often high, so it has to last) after he has sat a while
    A.loud = voice > 0.9 && close < 6 ? (A.loud || 0) + dt : Math.max(0, (A.loud || 0) - dt * 2);
    if (A.loud > 4 && A.t > 15 && Math.random() < dt * 0.1) this.leave('yell');
    else if (A.t > A.until) this.leave('done');
  }
}
