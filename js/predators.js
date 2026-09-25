// Things that hunt the host (both engineered, both random, neither lethal):
//   SpiderLeno - rarely, a spider with Grey Leno's head rappels down from the ceiling on a silk thread,
//                dangles after the host, lunges, and sometimes grabs him and reels him up for a few seconds
//                (the audience gasps) before letting go. It climbs back up after a while.
//   Swatter    - now and then a floating white cartoon glove brings a fly swatter and swats at the host,
//                knocking him around. Rarely it is an electric bug-zapper racket that zaps on contact.
// For the fly: approaching / swinging objects drive the LC4 looming neurons; hits and zaps drive
// mechanosensory neurons and punishment dopamine; a grab is touch plus being hauled into the air.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { propLOD } from './lod.js';
import { keep, disposeObject } from './dispose.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

function col(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}

// ------------------------------------------------------------------------------------------------ spider
let headGltf = null;

async function spiderModel() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05, flatShading: true });
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  // abdomen: Leno-grey with dark chevrons; cephalothorax dark
  const abd = new THREE.SphereGeometry(0.5, 14, 10).scale(1, 0.85, 1.25).toNonIndexed();
  abd.deleteAttribute('uv');
  { const pos = abd.attributes.position, c = new Float32Array(pos.count * 3), light = new THREE.Color(0x8c9196), dark = new THREE.Color(0x26262b);
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) / 0.625, x = Math.abs(pos.getX(i)), y = pos.getY(i);
      const chevron = y > 0.1 && ((z + x * 1.6) * 3.2 % 1 + 1) % 1 < 0.35;
      const k = chevron ? dark : light; c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b;
    }
    abd.setAttribute('color', new THREE.BufferAttribute(c, 3)); }
  body.add(new THREE.Mesh(mergeGeometries([
    abd.translate(0, 0.05, -0.62),
    col(new THREE.SphereGeometry(0.3, 12, 8).scale(1, 0.7, 1.15).translate(0, 0, 0.05), 0x2e2e33),
    col(new THREE.ConeGeometry(0.035, 0.18, 5).rotateX(Math.PI).translate(0.07, -0.22, 0.42), 0x111111),   // fangs
    col(new THREE.ConeGeometry(0.035, 0.18, 5).rotateX(Math.PI).translate(-0.07, -0.22, 0.42), 0x111111),
  ]), mat));
  // eight legs: femur up and out, tibia down to the tip
  const legMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2f, roughness: 0.6 });
  const femurG = new THREE.CylinderGeometry(0.035, 0.05, 0.9, 6).translate(0, 0.45, 0);
  const tibiaG = new THREE.CylinderGeometry(0.02, 0.035, 1.1, 6).translate(0, 0.55, 0);
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? 1 : -1, k = i % 4;
    const hip = new THREE.Group(); hip.position.set(0.2 * side, 0, 0.2 - k * 0.13);
    // hip's local +X points outward (fanning from front to back); femur rises up-and-out, tibia goes out-and-down
    const psi = 0.55 + k * 0.62, dx = side * Math.sin(psi), dz = Math.cos(psi);
    hip.rotation.y = Math.atan2(-dz, dx);
    const femur = new THREE.Mesh(femurG, legMat); femur.rotation.z = -0.9; hip.add(femur);
    const knee = new THREE.Group(); knee.position.set(0, 0.9, 0); femur.add(knee);
    const tibia = new THREE.Mesh(tibiaG, legMat); tibia.rotation.z = -1.4; knee.add(tibia);
    body.add(hip); legs.push({ hip, femur, tibia, side, k });
  }
  // Leno's head at the front
  headGltf ||= new GLTFLoader().loadAsync('assets/grey_leno_head.glb');
  const gltf = await headGltf;
  keep(gltf.scene);                                   // clones share the head's geometry and materials
  const head = gltf.scene.clone(true); head.scale.setScalar(1.7); head.position.set(0, 0.02, 0.42);
  body.add(head);
  const morphs = [];
  head.traverse((o) => { if (o.isMesh) { o.castShadow = true; const i = o.morphTargetDictionary?.MouthOpen; if (i !== undefined) morphs.push([o, i]); } });
  root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  root.scale.setScalar(1.3);                          // a big one: ~2.6 m leg span
  return { root, body, legs, head, morphs };
}

export class SpiderLeno {
  constructor(scene, sfx) { this.scene = scene; this.sfx = sfx; this.active = null; }

  async spawn(hostHead, ceilY) {
    if (this.active || this.loading) return false;
    this.loading = true;
    let m;
    try { m = await spiderModel(); } catch (e) { console.warn('spider-Leno: head model unavailable', e); this.loading = false; return false; }
    this.loading = false;
    const a = Math.random() * 6.28;
    const anchor = V(hostHead.x + Math.cos(a) * 1.5, ceilY, hostHead.z + Math.sin(a) * 1.5);
    m.root.position.copy(anchor).add(V(0, -0.6, 0));
    const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([anchor, anchor.clone()]),
      new THREE.LineBasicMaterial({ color: 0xe8e8f0, transparent: true, opacity: 0.8 }));
    thread.frustumCulled = false;
    this.scene.add(m.root, thread); propLOD.track(m.root);
    this.active = { ...m, anchor, thread, state: 'descend', t: 0, life: 38 + Math.random() * 10, lungeT: 2, len: 0.6, hang: 0, lunge: null, grab: null, mouth: 0 };
    this.sfx.sting('skitter', { gain: 0.6 });
    return true;
  }

  clear() { if (this.active) { disposeObject(this.active.root); disposeObject(this.active.thread); this.active = null; } }

  /** body centre and grab point */
  pos() { return this.active?.root.position.clone(); }
  grabPoint() { const A = this.active; return A ? A.root.position.clone().add(V(0, -0.75, 0)) : null; }

  leave() { if (this.active && this.active.state !== 'ascend') { this.active.state = 'ascend'; this.active.grab = null; } }

  /** returns an event string or null: 'lunge' | 'grab' | 'release' | 'miss' | 'gone' */
  update(dt, head, chest) {
    const A = this.active;
    if (!A || !dt) return null;
    A.t += dt;
    let ev = null;
    const r = A.root;
    // the anchor creeps along the ceiling to stay above the host (not while climbing away)
    if (A.state !== 'ascend') {
      const above = V(head.x, A.anchor.y, head.z), d = above.sub(A.anchor);
      const step = Math.min(d.length(), 1.1 * dt);
      if (step > 1e-4) A.anchor.addScaledVector(d.normalize(), step);
    }
    const hangY = head.y + 0.9;
    if (A.state === 'descend') {
      A.len += 2.4 * dt;
      if (A.anchor.y - A.len <= hangY) { A.state = 'hunt'; A.len = A.anchor.y - hangY; }
    }
    if (A.state === 'ascend') {
      A.len -= 3 * dt;
      if (A.len < 0.4) { this.clear(); return 'gone'; }
    }
    if (A.t > A.life && A.state === 'hunt') this.leave();
    // where the body wants to be: below the anchor, swung toward the host
    let target = A.anchor.clone().add(V(0, -A.len, 0));
    if (A.state === 'hunt' || A.state === 'grab') {
      const toHost = chest.clone().sub(target).setY(0), dist = toHost.length();
      target.addScaledVector(toHost.normalize(), Math.min(dist, 1.6) * 0.8);
      target.y = A.anchor.y - A.len + 0.25 * Math.sin(A.t * 1.7);
    }
    if (A.state === 'hunt') {
      A.lungeT -= dt;
      if (A.lungeT <= 0 && r.position.distanceTo(chest) < 2.8) {
        A.state = 'lunge'; A.lunge = { t: 0, from: r.position.clone() }; ev = 'lunge';
        this.sfx.sting('skitter', { gain: 0.8 });
      }
    }
    if (A.state === 'lunge') {
      const L = A.lunge; L.t += dt;
      const u = Math.min(1, L.t / 0.3);
      r.position.lerpVectors(L.from, chest.clone().add(V(0, 0.55, 0)), u * u);
      if (u >= 1) {
        if (r.position.distanceTo(chest) < 1.4 && Math.random() < 0.6) {
          A.state = 'grab'; A.grab = { t: 0, dur: 3 + Math.random() * 1.5 }; ev = 'grab';
          A.len = A.anchor.y - r.position.y;                   // thread length at the grab
        } else { A.state = 'hunt'; A.lungeT = 2.5 + Math.random() * 2; ev = 'miss'; }
      }
    } else if (A.state === 'grab') {
      const G = A.grab; G.t += dt;
      A.len = Math.max(1.2, A.len - 0.55 * dt);               // reels him up
      r.position.lerp(target, Math.min(1, dt * 3));
      if (G.t > G.dur) { A.state = 'hunt'; A.lungeT = 5 + Math.random() * 3; A.grab = null; A.len = A.anchor.y - hangY; ev = 'release'; }
    } else {
      r.position.lerp(target, Math.min(1, dt * (A.state === 'descend' || A.state === 'ascend' ? 8 : 2.5)));
    }
    // face the host, body tilted head-down while hanging
    const look = chest.clone().sub(r.position);
    r.rotation.y = Math.atan2(look.x, look.z);
    A.body.rotation.x = A.state === 'descend' || A.state === 'ascend' ? 0.9 : A.state === 'lunge' ? 0.2 : 0.55;
    // legs: tucked on the thread, pedalling while hunting, spread wide to grab
    const spread = A.state === 'lunge' || A.state === 'grab' ? 1 : A.state === 'hunt' ? 0.5 : 0.1;
    for (const l of A.legs) {
      const w = Math.sin(A.t * 9 + l.k * 1.3 + (l.side > 0 ? 0 : 1.5)) * (A.state === 'hunt' ? 0.25 : 0.08);
      l.femur.rotation.z = -(0.5 + 0.5 * spread + w);
      l.tibia.rotation.z = -(1.1 + 0.8 * (1 - spread));
    }
    // thread from the anchor to the spinnerets
    const spin = r.localToWorld(V(0, 0.35, -0.9));
    const pa = A.thread.geometry.attributes.position;
    pa.setXYZ(0, A.anchor.x, A.anchor.y, A.anchor.z); pa.setXYZ(1, spin.x, spin.y, spin.z); pa.needsUpdate = true;
    // Leno's mouth: agape when lunging / holding
    A.mouth += ((A.state === 'lunge' || A.state === 'grab' ? 1 : 0.1 + 0.1 * Math.sin(A.t * 3)) - A.mouth) * Math.min(1, dt * 6);
    for (const [o, i] of A.morphs) o.morphTargetInfluences[i] = A.mouth;
    return ev;
  }
}

// ------------------------------------------------------------------------------------------------ swatter
function gridTexture(color, holes = 10, electric = false) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d');
  if (!electric) { x.fillStyle = color; x.fillRect(0, 0, 128, 128); }
  x.fillStyle = electric ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,1)';
  x.strokeStyle = electric ? '#d9dde2' : color; x.lineWidth = electric ? 2 : 1;
  const s = 128 / holes;
  if (electric) { for (let k = 0; k <= holes; k++) { x.beginPath(); x.moveTo(k * s, 0); x.lineTo(k * s, 128); x.stroke(); x.beginPath(); x.moveTo(0, k * s); x.lineTo(128, k * s); x.stroke(); } }
  else for (let i = 0; i < holes; i++) for (let j = 0; j < holes; j++) { x.clearRect(i * s + 2, j * s + 2, s - 4, s - 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

function gloveAndTool(electric) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.75 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });
  const wrist = new THREE.Group(); g.add(wrist);
  // the tool, along +Z from the fist
  const tool = new THREE.Group(); wrist.add(tool);
  let head, frameMat = null;
  if (!electric) {
    const colr = ['#e03c31', '#2f7de1', '#f2c230', '#34a853'][(Math.random() * 4) | 0];
    tool.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.25, 8).rotateX(Math.PI / 2).translate(0, 0, 0.62), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 })));
    head = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.62).rotateX(-Math.PI / 2).translate(0, 0, 1.55),
      new THREE.MeshStandardMaterial({ map: gridTexture(colr), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7 }));
    tool.add(head);
    tool.add(new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.03, 0.03).translate(0, 0, 1.24), new THREE.MeshStandardMaterial({ color: colr })));
  } else {
    frameMat = new THREE.MeshStandardMaterial({ color: 0x1b3e8f, emissive: 0x1e7bff, emissiveIntensity: 0.3, roughness: 0.4 });
    tool.add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.75, 10).rotateX(Math.PI / 2).translate(0, 0, 0.38), new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 })));
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 28).scale(1, 1.3, 1).rotateX(Math.PI / 2).translate(0, 0, 1.2), frameMat);
    head = new THREE.Mesh(new THREE.CircleGeometry(0.33, 24).scale(1, 1.3, 1).rotateX(-Math.PI / 2).translate(0, 0, 1.2),
      new THREE.MeshStandardMaterial({ map: gridTexture('#ccc', 14, true), transparent: true, side: THREE.DoubleSide, emissive: 0x3aa0ff, emissiveIntensity: 0.15 }));
    tool.add(frame, head);
  }
  // the glove: palm, curled fingers round the handle, thumb over them, flared cuff with three seams
  const hand = new THREE.Group(); wrist.add(hand);
  hand.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10).scale(1.05, 0.8, 1).translate(0, 0, -0.05), white));
  for (let k = 0; k < 4; k++) {
    const f = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.055, 8, 12, Math.PI * 1.3), white);
    f.rotation.set(0, Math.PI / 2, 0.6); f.position.set(-0.03, 0.02, 0.12 - k * 0.065 - 0.02); hand.add(f);
  }
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.14, 4, 8).rotateX(Math.PI / 2 - 0.3), white); thumb.position.set(0.12, 0.08, 0.06); hand.add(thumb);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.2, 14, 1, true).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xf7f7f2, roughness: 0.75, side: THREE.DoubleSide }));
  cuff.position.set(0, 0, -0.32); hand.add(cuff);
  for (const x of [-0.06, 0, 0.06]) { const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.16), seam); s.position.set(x, 0.155, -0.12); hand.add(s); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(1.6);
  return { g, wrist, tool, head, frameMat };
}


export class Swatter {
  constructor(scene, sfx) {
    this.scene = scene; this.sfx = sfx; this.active = null;
    this.flash = new THREE.PointLight(0x6fc3ff, 0, 8, 2); scene.add(this.flash);
  }

  spawn(hostHead, electric = false) {
    if (this.active) return false;
    const m = gloveAndTool(electric);
    const a = Math.random() * 6.28;
    m.g.position.copy(hostHead).add(V(Math.cos(a) * 14, 6, Math.sin(a) * 14));
    this.scene.add(m.g); propLOD.track(m.g);
    this.active = { ...m, electric, reach: (electric ? 1.2 : 1.55) * 1.6, state: 'enter', t: 0, life: 22 + Math.random() * 8, cool: 1.2, swing: null, angle: -1.2, bolts: [], convulse: 0 };
    return true;
  }

  clear() {
    const A = this.active; if (!A) return;
    disposeObject(A.g); for (const b of A.bolts) disposeObject(b.line);
    this.flash.intensity = 0; this.active = null;
  }

  headPos() { return this.active ? this.active.head.getWorldPosition(V()) : null; }

  /** where the wrist must be so the tool head lands on `target` at the end of the swing (yaw faces the target) */
  strikeWrist(target, yaw, a = 0.9) {
    const dir = V(0, -Math.sin(a), Math.cos(a)).applyAxisAngle(V(0, 1, 0), yaw);
    return target.clone().addScaledVector(dir, -this.active.reach);   // reach: wrist -> tool head centre
  }

  /** returns an event: 'swing' | 'hit' | 'zap' | 'miss' | 'leaving' | 'gone' | null */
  update(dt, chest, hostVel = V(), head = chest) {
    const A = this.active;
    if (!A || !dt) return null;
    A.t += dt;
    const g = A.g;
    let ev = null;
    const toHost = chest.clone().sub(g.position).setY(0);
    const yaw = Math.atan2(toHost.x, toHost.z);
    const turn = (to) => { let d = to - g.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); g.rotation.y += d * Math.min(1, dt * 6); };
    const standoff = () => chest.clone().addScaledVector(toHost.clone().normalize(), -3.4).add(V(0, 1.8 + 0.2 * Math.sin(A.t * 2.3), 0));
    if (A.state === 'enter' || A.state === 'hover') {
      const want = standoff();
      g.position.lerp(want, Math.min(1, dt * (A.state === 'enter' ? 1.4 : 2.5)));
      turn(yaw); A.angle += (-1.2 - A.angle) * Math.min(1, dt * 4);
      if (A.state === 'enter' && g.position.distanceTo(want) < 1) A.state = 'hover';
      if (A.state === 'hover') {
        A.cool -= dt;
        if (A.t > A.life) { A.state = 'leave'; ev = 'leaving'; }
        else if (A.cool <= 0) {
          // aim where he'll be in half a second
          const aim = chest.clone().addScaledVector(hostVel.clone().setY(0), 0.3);
          A.swing = { t: 0, aim, yaw, wrist: this.strikeWrist(aim, yaw), from: g.position.clone(), hit: false };
          A.state = 'windup';
        }
      }
    } else if (A.state === 'windup') {
      const S = A.swing; S.t += dt;
      const u = Math.min(1, S.t / 0.45);
      g.position.lerpVectors(S.from, S.wrist.clone().add(V(0, 0.4, 0)), u);
      turn(S.yaw); A.angle = -1.2 - 0.5 * u;                  // raise it high
      if (u >= 1) { A.state = 'swing'; S.t = 0; this.sfx.sting('whoosh', { gain: 0.8 }); ev = 'swing'; }
    } else if (A.state === 'swing') {
      const S = A.swing; S.t += dt;
      const u = Math.min(1, S.t / 0.16);
      A.angle = -1.7 + 2.6 * u * u;
      g.position.lerp(S.wrist, Math.min(1, dt * 12));
      const hp = this.headPos();
      if (!S.hit && Math.min(hp.distanceTo(chest), hp.distanceTo(head)) < 1.4) {
        S.hit = true;
        if (A.electric) { ev = 'zap'; this.zap(hp, chest); } else { ev = 'hit'; this.sfx.sting('thwack', { gain: 1 }); }
      }
      if (u >= 1) {
        if (!S.hit) { ev = 'miss'; this.sfx.sting('thwack', { gain: 0.55 }); }
        A.state = 'recover'; S.t = 0;
      }
    } else if (A.state === 'recover') {
      const S = A.swing; S.t += dt;
      A.angle += (-1.2 - A.angle) * Math.min(1, dt * 3);
      g.position.lerp(standoff(), Math.min(1, dt * 1.5));
      if (S.t > 0.7) { A.state = 'hover'; A.cool = 1.6 + Math.random() * 2.2; }
    } else if (A.state === 'leave') {
      g.position.y += dt * (2 + A.t * 0.2); g.position.addScaledVector(toHost.clone().normalize(), -dt * 6);
      if (A.t > A.life + 5) { this.clear(); return 'gone'; }
    }
    A.wrist.rotation.x = A.angle;
    // the racket hums blue while armed (a slow glow); a zap's arcs crackle in shape but glow steadily and fade out,
    // so nothing flickers (photosensitivity)
    const glow = A.bolts.reduce((m, b) => Math.max(m, b.life / b.life0), 0);
    if (A.frameMat) A.frameMat.emissiveIntensity = 0.3 + 0.12 * Math.sin(A.t * 4) + 1.6 * glow;
    A.jitT = (A.jitT ?? 0) - dt;
    const jitter = A.jitT <= 0;
    if (jitter) A.jitT = 0.07;
    for (const b of A.bolts) {
      b.life -= dt;
      if (jitter) {
        const p = b.line.geometry.attributes.position;
        for (let i = 1; i < p.count - 1; i++) p.setXYZ(i, b.base[i].x + (Math.random() - 0.5) * 0.2, b.base[i].y + (Math.random() - 0.5) * 0.2, b.base[i].z + (Math.random() - 0.5) * 0.2);
        p.needsUpdate = true;
      }
      b.line.material.opacity = Math.max(0, b.life / b.life0);
      if (b.life <= 0) disposeObject(b.line);
    }
    A.bolts = A.bolts.filter((b) => b.life > 0);
    this.flash.intensity = 45 * glow;
    return ev;
  }

  zap(from, to) {
    const A = this.active;
    this.sfx.sting('zap', { gain: 0.9 });
    this.flash.position.copy(from);
    for (let k = 0; k < 4; k++) {
      const n = 9, base = [];
      for (let i = 0; i < n; i++) base.push(from.clone().lerp(to.clone().add(V((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.8)), i / (n - 1)));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(base), new THREE.LineBasicMaterial({ color: 0xbfe6ff, toneMapped: false, transparent: true }));
      line.frustumCulled = false; this.scene.add(line);
      const life = 0.4 + Math.random() * 0.2;
      A.bolts.push({ line, base, life, life0: life });
    }
  }
}

// ------------------------------------------------------------------------------------------------ scheduler
export class Predators {
  /**
   * ctx: { scene, sfx, hostHead(), hostChest(), hostVel(), isFly(), ceilY, knock(v), hold(p|null), convulse(sec),
   *        pulse, reinforce, crowd, react, ticker, allowed(switch) }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.spider = new SpiderLeno(ctx.scene, ctx.sfx);
    this.swatter = new Swatter(ctx.scene, ctx.sfx);
    this.enabled = true;
    this.spiderT = 150 + Math.random() * 200;       // rare
    this.swatT = 70 + Math.random() * 110;
    this.holding = false;
  }

  get busy() { return !!(this.spider.active || this.swatter.active || this.spider.loading); }

  async dropSpider() {
    const ok = await this.spider.spawn(this.ctx.hostHead(), this.ctx.ceilY);
    if (ok) { this.ctx.ticker('Something is coming down from the ceiling on a thread…'); this.ctx.pulse('spiderLoom', 'heckler', 120, 0.6); }
    return ok;
  }

  sendSwatter(electric = Math.random() < 0.25) {
    if (!this.swatter.spawn(this.ctx.hostHead(), electric)) return false;
    this.ctx.ticker(electric ? 'A floating white glove arrives with an electric bug racket' : 'A floating white glove arrives with a fly swatter');
    return true;
  }

  update(dt, showOn) {
    if (!dt) return;
    const ctx = this.ctx;
    if (this.enabled && showOn && !this.busy) {
      this.spiderT -= dt; this.swatT -= dt;
      if (this.spiderT <= 0) {
        this.spiderT = 240 + Math.random() * 300; this.swatT = Math.max(this.swatT, 40);
        if (ctx.allowed('spider')) this.dropSpider();
      } else if (this.swatT <= 0) {
        this.swatT = 90 + Math.random() * 150;
        const plain = ctx.allowed('swatter'), zap = ctx.allowed('racket');
        if (plain || zap) this.sendSwatter(zap && (!plain || Math.random() < 0.25));
      }
    }
    const head = ctx.hostHead(), chest = ctx.hostChest();
    // spider
    const sev = this.spider.update(dt, head, chest);
    if (sev === 'lunge') ctx.pulse('spiderLoom', 'heckler', 220, 0.35);
    if (sev === 'grab') {
      this.holding = true;
      ctx.crowd('gasp', 1); ctx.pulse('spiderGrab', 'ambientTouch', 90, 0.8); ctx.reinforce(-0.6, 1.2);
      ctx.ticker('Spider-Leno grabs him!');
    }
    if (sev === 'miss') { ctx.knock(chest.clone().sub(this.spider.pos() ?? chest).setY(0.3).normalize().multiplyScalar(150)); ctx.pulse('spiderBump', 'ambientTouch', 40, 0.3); }
    if (sev === 'release') { this.holding = false; ctx.hold(null); ctx.ticker('…and drops him'); ctx.react('spiderDrop'); }
    if (sev === 'gone') ctx.ticker('Spider-Leno climbs back into the rafters');
    if (this.holding) {
      if (this.spider.active?.state === 'grab') ctx.hold(this.spider.grabPoint());
      else { this.holding = false; ctx.hold(null); }
    }
    // swatter / racket
    const wev = this.swatter.update(dt, chest, ctx.hostVel(), head);
    if (wev === 'swing') ctx.pulse('swatLoom', 'heckler', 200, 0.3);
    if (wev === 'hit') {
      const from = this.swatter.active.g.position;
      ctx.knock(chest.clone().sub(from).setY(0).normalize().multiplyScalar(260).add(V(0, -60, 0)));
      ctx.pulse('swatHit', 'ambientTouch', 100, 0.5); ctx.reinforce(-0.6, 1); ctx.react('swatHit');
      ctx.ticker('SWAT!');
    }
    if (wev === 'zap') {
      const from = this.swatter.active.g.position;
      ctx.knock(chest.clone().sub(from).setY(0).normalize().multiplyScalar(160));
      ctx.pulse('zapTouch', 'ambientTouch', 160, 0.6); ctx.pulse('zapAnt', 'applause', 150, 0.4); ctx.reinforce(-0.9, 1.4);
      ctx.convulse(0.7); ctx.react('zap'); ctx.ticker('BZZZT! The racket zaps him');
    }
    if (wev === 'leaving') ctx.ticker('The glove floats away');
  }

  /** things that loom toward the fly */
  loomers() {
    const out = [];
    const sp = this.spider.active;
    if (sp && (sp.state === 'descend' || sp.state === 'lunge')) out.push({ p: sp.root.position, r: 0.9 });
    const sw = this.swatter.active;
    if (sw && (sw.state === 'windup' || sw.state === 'swing')) out.push({ p: this.swatter.headPos(), r: 0.5 });
    return out;
  }

  clear() { this.spider.clear(); this.swatter.clear(); if (this.holding) { this.holding = false; this.ctx.hold(null); } }

  /** Peaceful Mode switched on: both leave now (the spider climbs away, the glove floats off) */
  calmDown() {
    this.spider.leave();
    const sw = this.swatter.active;
    if (sw && sw.state !== 'leave') { sw.state = 'leave'; sw.life = Math.min(sw.life, sw.t); }
    if (this.holding) { this.holding = false; this.ctx.hold(null); }
  }
}
