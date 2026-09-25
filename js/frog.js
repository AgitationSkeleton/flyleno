// Mr. Frog, tonight's guest ("Give it up for Mr. Frog!"): a frog-headed man in a grey robe with a rope belt, black
// gloves and a black beanie. He walks on from the wings, stands across from Leno, and answers every question with
// "Good. Good. Good." (croaks, his jaw working).
// He is also a fly's natural predator. On some visits he now and then opens his mouth and flicks his tongue at the
// host: for the fly, a looming object (LC4) and a hit on the body (mechanosensory), and Fly-Leno can get caught and
// spat out. On others he has brought a toy revolver like the Jonkler's (no BANG! flag in this one) and takes shots
// at him.
// He leaves when his segment is over, when Leno bites his ankles ("I'll inch my way over and bite your ankles"),
// or when Leno yells at him ("You're out of here, Mr. Frog!").
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored, limb, FIGURE_SCALE, NECK } from './cultist-model.js';
import { toyRevolver } from './jonkler.js';
import { propLOD } from './lod.js';
import { disposeObject } from './dispose.js';

const S = FIGURE_SCALE;
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WALK = 1.5;                                  // m/s
const ROBE = 0x45474a, BELT = 0xb58d4e, GLOVE = 0x121212, SHOE = 0x0e0e0e, SKIN = 0x6f7b3b, SKIN_DARK = 0x4f5a28,
  LIP = 0x57542c, MOUTH = 0x3b1010, EYE = 0xf1f1ee, IRIS = 0x78b8ee, PUPIL = 0x0a0a0a, CAP = 0x141414;
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };

// the head is a sphere (centre HY above the neck, radius R, a little squashed), cut at the mouth line MY: above it
// the cranium, below it the jaw
const HY = 0.165, R = 0.21, SY = 0.95, MY = 0.12, CUT = Math.acos((MY - HY) / (R * SY));

function frogModel() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.08, side: THREE.DoubleSide });
  const mk = (geo) => { const m = new THREE.Mesh(geo.scale(S, S, S), mat); m.castShadow = true; return m; };
  const g = new THREE.Group();
  // the robe, to the floor, black shoes peeking out (origin at the waist)
  const skirt = mk(mergeGeometries([
    colored(new THREE.CylinderGeometry(0.22, 0.34, 0.7, 12, 1).translate(0, -0.35, 0), ROBE),
    ...[-1, 1].map((s) => colored(new THREE.SphereGeometry(0.07, 8, 6).scale(1, 0.55, 1.7).translate(0.1 * s, -0.7, 0.22), SHOE)),
  ]));
  const body = mk(mergeGeometries([
    colored(new THREE.CylinderGeometry(0.2, 0.23, 0.64, 12, 1).translate(0, 0.32, 0), ROBE),
    colored(new THREE.CylinderGeometry(0.236, 0.236, 0.07, 14, 1).translate(0, 0.04, 0), BELT),
    colored(new THREE.CylinderGeometry(0.12, 0.18, 0.1, 12, 1).translate(0, 0.66, 0), ROBE),
  ]));
  // the head (origin at the neck): the cranium above the mouth line under a black beanie (a snug crown, a folded cuff), a wide
  // upper lip, nostrils, and the mouth's dark roof (seen when the jaw drops)
  const head = new THREE.Group();
  head.add(mk(mergeGeometries([
    colored(new THREE.SphereGeometry(R, 14, 10, 0, Math.PI * 2, 0, CUT).scale(1.12, SY, 1).translate(0, HY, 0), SKIN),
    colored(new THREE.SphereGeometry(R * 1.05, 18, 7, 0, Math.PI * 2, 0, Math.PI * 0.34).scale(1.12, SY * 1.08, 1.05).translate(0, HY + 0.005, -0.005), CAP),
    colored(new THREE.CylinderGeometry(0.2, 0.203, 0.05, 20, 1, true).scale(1.12, 1, 1.05).translate(0, 0.272, -0.005), CAP),
    colored(new THREE.TorusGeometry(R * 0.98, 0.016, 5, 16, Math.PI).rotateX(Math.PI / 2).scale(1.12, 1, 1.02).translate(0, MY + 0.005, 0), LIP),
    ...[-1, 1].map((s) => colored(new THREE.SphereGeometry(0.012, 5, 4).translate(0.03 * s, 0.175, 0.2), SKIN_DARK)),
    colored(new THREE.CircleGeometry(R * 0.97, 14).rotateX(Math.PI / 2).scale(1.12, 1, 1).translate(0, MY + 0.002, 0), MOUTH),
  ])));
  // big blue eyes under heavy lids (their own mesh, never simplified: they make him Mr. Frog at any distance)
  const eyes = mk(mergeGeometries([-1, 1].flatMap((s) => [
    colored(new THREE.SphereGeometry(0.065, 10, 8).translate(0.1 * s, 0.235, 0.15), EYE),
    colored(new THREE.SphereGeometry(0.042, 8, 6).scale(1, 1, 0.45).translate(0.1 * s, 0.232, 0.205), IRIS),
    colored(new THREE.SphereGeometry(0.02, 6, 4).scale(1, 1, 0.45).translate(0.1 * s, 0.232, 0.214), PUPIL),
    colored(new THREE.SphereGeometry(0.07, 10, 5, 0, Math.PI * 2, 0, Math.PI * 0.42).rotateX(0.35).translate(0.1 * s, 0.235, 0.15), SKIN),
  ])));
  eyes.userData.noLOD = true;
  head.add(eyes);
  // the jaw hinges at the back of the mouth: the chin, the lower lip and the tongue bed
  const jaw = new THREE.Group(); jaw.position.set(0, MY * S, -0.1 * S); head.add(jaw);
  jaw.add(mk(mergeGeometries([
    colored(new THREE.SphereGeometry(R, 14, 8, 0, Math.PI * 2, CUT, Math.PI - CUT).scale(1.12, SY, 1).translate(0, HY - MY, 0.1), SKIN),
    colored(new THREE.TorusGeometry(R * 0.98, 0.018, 5, 16, Math.PI).rotateX(Math.PI / 2).scale(1.12, 1, 1.02).translate(0, -0.005, 0.1), LIP),
    colored(new THREE.CircleGeometry(R * 0.97, 14).rotateX(-Math.PI / 2).scale(1.12, 1, 1).translate(0, -0.002, 0.1), MOUTH),
  ])));
  head.position.copy(NECK).multiplyScalar(S); head.scale.setScalar(1.25);          // (a big head: about as wide as his shoulders)
  // the tongue: a pink strip along +Z from the mouth, scaled to reach its target, with a sticky tip
  const tongue = new THREE.Group(); tongue.position.set(0, MY * S, 0.12 * S); head.add(tongue);
  const tmat = new THREE.MeshStandardMaterial({ color: 0xe0607a, roughness: 0.35 });
  const strip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 1, 6).rotateX(Math.PI / 2).translate(0, 0, 0.5), tmat);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), tmat);
  tongue.add(strip, tip); tongue.visible = false;
  // sleeves flaring at the cuffs, black gloves
  const arm = (side) => mk(mergeGeometries([
    limb(V(0, 0, 0), V(0.03 * side, -0.47, 0.04), 0.07, 0.115, ROBE, 8),
    colored(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.2, 1.15).translate(0.03 * side, -0.56, 0.05), GLOVE),
  ]));
  const armL = arm(1); armL.position.set(0.25 * S, 0.6 * S, 0);
  const armR = arm(-1); armR.position.set(-0.25 * S, 0.6 * S, 0);
  // the toy revolver in his right hand (only on the visits he brings it), and its muzzle flash
  const gun = toyRevolver(); gun.position.copy(V(-0.03, -0.58, 0.05).multiplyScalar(S)); armR.add(gun);
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xffd27a, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, transparent: true }));
  flash.position.copy(gun.muzzle).add(V(0, -0.06, 0)); flash.scale.setScalar(0.32); flash.visible = false; gun.add(flash);
  skirt.position.y = 0.72 * S; body.position.y = 0.72 * S;
  body.add(head, armL, armR);
  g.add(skirt, body);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, body, head, jaw, armL, armR, gun, flash, tongue, strip, tip };
}

export class Frog {
  constructor({ scene, stage, sfx, onEvent }) {
    Object.assign(this, { scene, stage, sfx, onEvent });
    this.active = null;
    this.attacksOn = true;                        // (switch: his tongue and his gun can be off)
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

  /** Mr. Frog walks on for `dur` seconds; on about half his visits he has brought a toy revolver */
  enter(getHost, dur = 45) {
    if (this.active) return;
    const m = frogModel(), side = Math.random() < 0.5 ? -1 : 1;
    const start = this.center.clone().add(new THREE.Vector3(side * 12, 0, 1)); start.y = this.groundAt(start);
    m.g.position.copy(start); this.scene.add(m.g); propLOD.track(m.g, { mid: 0.7, far: 0.35 });
    this.getHost = getHost;
    const armed = this.attacksOn && Math.random() < 0.5;
    m.gun.visible = armed;
    this.active = { ...m, state: 'enter', t: 0, until: dur, croakT: 3, attackT: 5 + Math.random() * 4, exit: start.clone(),
      strike: null, shot: null, caught: false, armed, phase: 0, talk: 0 };
    this.onEvent?.('enter', { armed });
  }

  /** "You're out of here, Mr. Frog!" */
  leave(reason = 'done') {
    const A = this.active;
    if (!A || A.state === 'exit') return;
    A.state = 'exit'; A.shot = null; A.flash.visible = false; this.retract();
    this.onEvent?.('leave', { reason });
  }

  clear() { if (this.active) { disposeObject(this.active.g); this.active = null; } }

  headPos() { return this.active ? this.active.head.localToWorld(V(0, 0.22 * S, 0.1 * S)) : null; }
  tipPos() { return this.active?.tongue.visible ? this.active.tip.getWorldPosition(new THREE.Vector3()) : null; }

  hostTarget() {
    const h = this.getHost();
    return (h.state?.headPos ?? h.position).clone();
  }

  /** a guest spot across from Leno */
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

  /** a step of walking toward `p` (body bob, arm swing); true once he's there */
  walkTo(p, dt) {
    const A = this.active, g = A.g, d = p.clone().sub(g.position).setY(0), dist = d.length();
    if (dist < 0.35) return true;
    g.position.addScaledVector(d.normalize(), Math.min(WALK, dist * 3) * dt);
    g.position.y += (this.groundAt(g.position) - g.position.y) * Math.min(1, dt * 12);
    let dy = Math.atan2(d.x, d.z) - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    g.rotation.y += dy * Math.min(1, dt * 8);
    A.phase += dt * 7;
    A.body.position.y = 0.72 * S + Math.abs(Math.sin(A.phase)) * 0.04;
    A.armL.rotation.x = Math.sin(A.phase) * 0.45; A.armR.rotation.x = -Math.sin(A.phase) * 0.45;
    return false;
  }

  face(p, k = 0.08) {
    const A = this.active, d = p.clone().sub(A.g.position);
    let dy = Math.atan2(d.x, d.z) - A.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    A.g.rotation.y += dy * k;
  }

  /** open wide and flick the tongue at the host */
  strike() {
    const A = this.active;
    if (!A || A.strike) return;
    A.strike = { t: 0, hit: false };
    this.sfx.thwip({ gain: 0.8 });
    this.onEvent?.('tongue');
  }

  retract() { const A = this.active; if (A) { A.tongue.visible = false; A.strike = null; } }

  /** raise the revolver at the host (it goes off 0.9 s later) */
  aim() {
    const A = this.active;
    if (!A || A.shot) return;
    A.shot = { t: 0, fired: false, flashT: 0 };
    this.onEvent?.('aim');
  }

  update(dt, { hostIsFly = false, hostMouthOpen = 0, voice = 0 } = {}) {
    const A = this.active;
    if (!A || !dt) return;
    A.t += dt;
    A.armL.rotation.set(0, 0, 0); A.armR.rotation.set(0, 0, 0); A.body.position.y = 0.72 * S;
    // the jaw: flapping with each croak, wide open for the tongue
    A.talk = Math.max(0, A.talk - dt);
    const open = A.strike ? 0.55 : A.talk > 0 ? 0.3 * Math.sin(Math.PI * (1 - A.talk / 0.32)) : 0;
    A.jaw.rotation.x += (open - A.jaw.rotation.x) * Math.min(1, dt * 25);
    if (A.state === 'enter') {
      if (this.walkTo(this.seat(), dt)) { A.state = 'stand'; this.onEvent?.('seated'); }
      return;
    }
    if (A.state === 'exit') {
      if (this.walkTo(A.exit, dt)) { this.clear(); this.onEvent?.('gone'); }
      return;
    }
    // standing across from the host: face him, breathe, croak, and now and then attack
    const target = this.hostTarget();
    this.face(target, A.shot ? 0.2 : 0.08);
    A.body.scale.y = 1 + 0.01 * Math.sin(A.t * 2.4);
    A.croakT -= dt;
    if (A.croakT <= 0) {
      // "Good. Good. Good. Good..." : a run of croaks
      const n = 2 + ((Math.random() * 6) | 0);
      for (let k = 0; k < n; k++) setTimeout(() => { if (this.active === A) { this.sfx.croak({ gain: 0.75 }); A.talk = 0.32; } }, k * 520);
      A.croakT = n * 0.52 + 3 + Math.random() * 6;
      this.onEvent?.('croak', { n });
    }
    const mouth = A.head.localToWorld(A.tongue.position.clone());
    const reach = target.distanceTo(mouth);
    A.attackT -= dt * (hostIsFly ? 2.2 : 1);          // a fly-sized host is much more interesting
    if (!A.strike && !A.shot && A.attackT <= 0 && reach < (A.armed ? 9 : 6.5)) {
      A.attackT = 6 + Math.random() * 9;
      if (this.attacksOn) { if (A.armed) this.aim(); else this.strike(); }
    }
    // the tongue: out in 0.12 s, sticks 0.15 s, back in 0.2 s
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
    // the revolver: up and pointed at him (from the shoulder), BANG with a kick and a flash, a moment, back down
    if (A.shot) {
      const T = A.shot; T.t += dt;
      const up = T.t < 0.5 ? smooth(T.t / 0.5) : T.t < 1.5 ? 1 : Math.max(0, 1 - (T.t - 1.5) / 0.4);
      const sh = A.armR.getWorldPosition(V());
      const drop = Math.atan2(sh.y - target.y, Math.hypot(target.x - sh.x, target.z - sh.z));
      const kick = T.fired && T.t < 1.1 ? 0.3 * (1 - (T.t - 0.9) / 0.2) : 0;
      A.armR.rotation.x = -(Math.PI / 2 - drop) * up - kick;
      if (!T.fired && T.t >= 0.9) {
        T.fired = true; T.flashT = 0.07; A.flash.visible = true;
        this.sfx.sting('gunshot', { gain: 0.9 });
        this.onEvent?.('shot', { hit: Math.random() < 0.7, from: A.gun.localToWorld(A.gun.muzzle.clone()) });
      }
      if (T.flashT > 0) { T.flashT -= dt; if (T.flashT <= 0) A.flash.visible = false; }
      if (T.t > 1.9) A.shot = null;
    }
    // Leno bites his ankles (mouth open or feeding, right next to him) or yells him off stage
    const close = (this.getHost().position ?? target).distanceTo(A.g.position);
    if (close < 1.4 && hostMouthOpen > 0.5) this.leave('bite');
    // yelling: a sustained loud stretch (the fly's voicing is often high, so it has to last) after he has stood a while
    A.loud = voice > 0.9 && close < 6 ? (A.loud || 0) + dt : Math.max(0, (A.loud || 0) - dt * 2);
    if (A.loud > 4 && A.t > 15 && Math.random() < dt * 0.1) this.leave('yell');
    else if (A.t > A.until) this.leave('done');
  }
}
