// The clown car (engineered, random, off with its switch or Peaceful Mode): a tiny polka-dot car putters onto the
// stage and stops near Leno. Twelve full-size clowns climb out of it one after another, fan out around him and pelt
// him with cream pies, several each, rapid-fire, to circus music (honking as they walk). A pie in the face shoves him hard (slapstick) but
// hardly hurts, and it's sweet; pies that land on the floor are food. Then they all pile back in and it drives off.
// For the fly: the car and the clowns are movers (looming), the pies are looming objects, touch and sugar taste.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored, limb, FIGURE_SCALE, NECK } from './cultist-model.js';
import { propLOD } from './lod.js';
import { keep, disposeObject } from './dispose.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];
const S = FIGURE_SCALE;

// ------------------------------------------------------------------------------------------------ a clown
const SUITS = [[0xe8322a, 0xf2c230], [0x2f7de1, 0xf2f2f2], [0x34a853, 0xe8322a], [0x9b59d0, 0xf29f30], [0xf2c230, 0x2f7de1], [0xff5fa2, 0x34c7c7]];
const HAIR = [0xff7a1a, 0x2f7de1, 0x34c759, 0xff4fa3, 0xf2d230, 0xe8322a];
let clownMat = null;

/** a standing clown with the same rig as the stagehands (js/cultist-model.js standingFigure): .skirt (baggy trousers
 *  and big shoes), .body (a two-tone suit with pompoms and a ruffle), .head (white face, red nose, frizzy hair, a tiny
 *  hat), .armL/.armR (sleeves and white gloves), .handOffset */
export function clownFigure() {
  clownMat ||= keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75, side: THREE.DoubleSide }));
  const [a, b] = pick(SUITS), hair = pick(HAIR), hat = pick(SUITS)[0];
  const two = (geo, x0 = 0) => {                       // left half one colour, right half the other
    const g = geo.index ? geo.toNonIndexed() : geo, p = g.attributes.position, c = new Float32Array(p.count * 3);
    const ca = new THREE.Color(a), cb = new THREE.Color(b);
    for (let i = 0; i < p.count; i++) { const k = p.getX(i) >= x0 ? ca : cb; c[i * 3] = k.r; c[i * 3 + 1] = k.g; c[i * 3 + 2] = k.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
  };
  const mk = (geo) => { const m = new THREE.Mesh(geo.scale(S, S, S), clownMat); m.castShadow = true; return m; };
  const g = new THREE.Group();
  // trousers and shoes (origin at the waist; the floor is 0.72 below)
  g.skirt = mk(mergeGeometries([
    two(new THREE.CylinderGeometry(0.2, 0.34, 0.62, 10, 1).translate(0, -0.33, 0)),
    ...[-1, 1].map((s) => colored(new THREE.SphereGeometry(0.1, 10, 6).scale(1.2, 0.75, 2.3).translate(0.12 * s, -0.68, 0.09), 0xe01c1c)),
  ]));
  // suit, pompoms, ruffle
  g.body = mk(mergeGeometries([
    two(new THREE.CylinderGeometry(0.19, 0.27, 0.62, 10, 1).translate(0, 0.31, 0)),
    ...[0.16, 0.31, 0.46].map((y, i) => colored(new THREE.SphereGeometry(0.04, 8, 6).translate(0, y, 0.22 - (y - 0.16) * 0.12), [0xffffff, hair, 0xffffff][i])),
    colored(new THREE.TorusGeometry(0.16, 0.055, 6, 14).rotateX(Math.PI / 2).translate(0, 0.63, 0), 0xffffff),
  ]));
  // head around the neck pivot: white face, red nose, eyes, a smile, frizzy hair tufts, a tiny hat
  g.head = mk(mergeGeometries([
    colored(new THREE.SphereGeometry(0.15, 12, 10).translate(0, 0.14, 0), 0xf7f3ee),
    colored(new THREE.SphereGeometry(0.048, 10, 8).translate(0, 0.13, 0.155), 0xe01c1c),
    ...[-1, 1].map((s) => colored(new THREE.SphereGeometry(0.02, 6, 4).translate(0.055 * s, 0.19, 0.135), 0x111111)),
    colored(new THREE.TorusGeometry(0.065, 0.013, 5, 12, Math.PI).rotateZ(Math.PI).translate(0, 0.08, 0.13), 0xe01c1c),
    ...[[-0.15, 0.17, -0.02], [0.15, 0.17, -0.02], [-0.11, 0.25, -0.07], [0.11, 0.25, -0.07], [0, 0.26, -0.1]].map(([x, y, z]) =>
      colored(new THREE.IcosahedronGeometry(0.085, 0).translate(x, y, z), hair)),
    colored(new THREE.ConeGeometry(0.06, 0.15, 8).rotateZ(-0.25).translate(0.04, 0.34, 0), hat),
    colored(new THREE.SphereGeometry(0.025, 6, 4).translate(0.06, 0.42, 0), 0xffffff),
  ]));
  g.head.position.copy(NECK).multiplyScalar(S);
  const arm = (side) => mk(mergeGeometries([
    limb(V(0, 0, 0), V(0.03 * side, -0.52, 0.04), 0.07, 0.085, side > 0 ? a : b, 6),
    colored(new THREE.SphereGeometry(0.07, 8, 6).scale(1, 1.1, 1.2).translate(0.03 * side, -0.6, 0.05), 0xffffff),
  ]));
  g.armL = arm(1); g.armL.position.set(0.24 * S, 0.6 * S, 0);
  g.armR = arm(-1); g.armR.position.set(-0.24 * S, 0.6 * S, 0);
  g.skirt.position.y = 0.72 * S; g.body.position.y = 0.72 * S;
  g.body.add(g.head, g.armL, g.armR);
  g.add(g.skirt, g.body);
  g.handOffset = V(0.03, -0.58, 0.05).multiplyScalar(S);
  return g;
}

// ------------------------------------------------------------------------------------------------ the car
function carModel() {
  const body = pick(SUITS)[0], cab = pick(SUITS)[1];
  const parts = [
    colored(new THREE.BoxGeometry(1.1, 0.5, 1.7).translate(0, 0.62, 0), body),                       // tub
    colored(new THREE.SphereGeometry(0.62, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.85, 0.95, 0.95).translate(0, 0.86, -0.1), cab),   // bubble cabin
    colored(new THREE.BoxGeometry(0.95, 0.3, 0.05).translate(0, 1.05, 0.46), 0xbfe3f5),                 // windscreen
    colored(new THREE.BoxGeometry(1.14, 0.06, 1.74).translate(0, 0.87, 0), 0xffffff),                    // stripe
    colored(new THREE.CylinderGeometry(0.03, 0.05, 0.2, 6).translate(0.35, 1.0, 0.72), 0xf2c230),       // bulb horn
    colored(new THREE.SphereGeometry(0.075, 8, 6).translate(0.35, 1.12, 0.72), 0xe01c1c),
  ];
  // polka dots on both sides
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) {
    parts.push(colored(new THREE.CylinderGeometry(0.07, 0.07, 0.02, 10).rotateZ(Math.PI / 2).translate(0.56 * s, 0.5 + (k % 2) * 0.2, -0.65 + k * 0.32), pick(HAIR)));
  }
  const wheels = [];
  for (const [x, z] of [[-0.55, 0.55], [0.55, 0.55], [-0.55, -0.55], [0.55, -0.55]]) {
    parts.push(colored(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14).rotateZ(Math.PI / 2).translate(x, 0.33, z), 0x151515));
    parts.push(colored(new THREE.CylinderGeometry(0.13, 0.13, 0.24, 10).rotateZ(Math.PI / 2).translate(x, 0.33, z), 0xf2f2f2));
  }
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, metalness: 0.1 });
  const m = new THREE.Mesh(mergeGeometries(parts), mat); m.castShadow = true;
  g.add(m); g.scale.setScalar(1.25);
  return { g, mesh: m, wheels };
}

// ------------------------------------------------------------------------------------------------ the event
export class ClownCar {
  /** ctx: { scene, sfx, npcs, center, stageRadius, groundAt(p), hostPos(), ticker, crowd, throwPie(hand), pan(p) } */
  constructor(ctx) { this.ctx = ctx; this.active = null; }

  get present() { return !!this.active; }

  start() {
    if (this.active) return false;
    const ctx = this.ctx, c = ctx.center, side = Math.random() < 0.5 ? -1 : 1;
    const m = carModel();
    const start = c.clone().add(V(side * 15, 0, rand(-1, 2)));
    m.g.position.copy(start); m.g.position.y = ctx.groundAt(start) ?? c.y;
    ctx.scene.add(m.g); propLOD.track(m.g);
    // it pulls up about 4.5 m from him, on its own side, somewhere on the stage
    const h = ctx.hostPos(), dir = start.clone().sub(h).setY(0).normalize();
    const stop = h.clone().addScaledVector(dir, 4.5);
    const fromC = stop.clone().sub(c).setY(0), lim = ctx.stageRadius * 0.72;
    if (fromC.length() > lim) stop.copy(c).addScaledVector(fromC.setLength(lim), 1);
    this.active = { ...m, side, phase: 'arrive', stop, exit: c.clone().add(V(-side * 16, 0, rand(-1, 2))), speed: 0, t: 0,
      out: 0, back: 0, n: 12, nextOut: 0.6, bounce: 0, clowns: [], engine: ctx.sfx.engine(), music: ctx.sfx.circus({ gain: 0.32 }) };
    ctx.sfx.sting('clownhorn', { gain: 0.8 });
    ctx.ticker('A tiny clown car putters onto the stage…');
    return true;
  }

  /** everyone back in the car and away (Peaceful Mode) */
  leave() {
    const A = this.active; if (!A || A.phase === 'leave') return;
    for (const cl of A.clowns) cl.remove();
    A.clowns = []; A.phase = 'leave'; A.speed = 0;
  }

  clear() {
    const A = this.active; if (!A) return;
    A.engine.stop(); A.music.stop();
    for (const cl of A.clowns) cl.remove();
    disposeObject(A.g); this.active = null;
  }

  /** the car's door: its side facing Leno */
  door() {
    const A = this.active, h = this.ctx.hostPos(), p = A.g.position;
    const d = h.clone().sub(p).setY(0); if (d.lengthSq() < 1e-6) d.set(1, 0, 0);
    return p.clone().addScaledVector(d.normalize(), 1.1);
  }

  spawnClown(i) {
    const A = this.active, ctx = this.ctx, door = this.door(), h = ctx.hostPos();
    // they fan out in an arc facing him, 3.2-4.4 m away
    const base = Math.atan2(door.x - h.x, door.z - h.z), a = base + (i - (A.n - 1) / 2) * 0.24, r = rand(3.2, 4.4);
    const spot = h.clone().add(V(Math.sin(a) * r, 0, Math.cos(a) * r));
    const fig = clownFigure();
    const cl = ctx.npcs.clown(fig, door, spot, () => ({ pos: ctx.hostPos() }), 3 + ((Math.random() * 3) | 0), {
      door: () => (this.active ? this.door() : door),
      onThrow: (hand) => ctx.throwPie(hand),
      onBack: () => { if (this.active) { this.active.back++; this.active.bounce = 1; } },
    });
    A.clowns.push(cl);
  }

  update(dt) {
    const A = this.active; if (!A || !dt) return;
    const ctx = this.ctx, g = A.g;
    A.t += dt;
    A.clowns = A.clowns.filter((cl) => !cl.done);
    // clowns honk as they walk (each its own horn pitch)
    for (const cl of A.clowns) {
      if (cl.plan[0]?.type !== 'walk') continue;
      cl.pitch ??= rand(0.8, 1.35);
      cl.honkT = (cl.honkT ?? rand(0, 0.5)) - dt;
      if (cl.honkT <= 0) { cl.honkT = rand(0.4, 0.75); ctx.sfx.honk({ gain: 0.22, pitch: cl.pitch, pan: ctx.pan?.(cl.fig.position) ?? 0 }); }
    }
    let target = null, want = 0;
    if (A.phase === 'arrive') { target = A.stop; want = 2.6; }
    if (A.phase === 'leave') { target = A.exit; want = 3.4; }
    if (target) {
      const d = target.clone().sub(g.position).setY(0), dist = d.length();
      if (A.phase === 'arrive' && dist < 0.3) {
        A.phase = 'unload'; A.speed = 0;
        ctx.sfx.sting('clownhorn', { gain: 0.8 });
        ctx.ticker('…and clowns start climbing out of it. Lots of clowns.');
      } else if (A.phase === 'leave' && dist < 1) { this.clear(); ctx.ticker('The clown car putters away'); return; }
      else {
        let dy = Math.atan2(d.x, d.z) - g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        g.rotation.y += THREE.MathUtils.clamp(dy, -2 * dt, 2 * dt);
        want = Math.min(want, dist * 1.5);
        A.speed += THREE.MathUtils.clamp(want - A.speed, -5 * dt, 3 * dt);
        g.position.addScaledVector(V(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y)), A.speed * dt);
        g.position.y += ((ctx.groundAt(g.position) ?? g.position.y) - g.position.y) * Math.min(1, dt * 8);
      }
    }
    if (A.phase === 'unload') {
      A.nextOut -= dt;
      if (A.nextOut <= 0 && A.out < A.n) { this.spawnClown(A.out); A.out++; A.nextOut = 0.45; A.bounce = 1; }
      if (A.out >= A.n) A.phase = 'pelt';
    }
    if (A.phase === 'pelt' && (A.back >= A.n || !A.clowns.length || A.t > 80)) {
      for (const cl of A.clowns) cl.remove();
      A.clowns = []; A.phase = 'leave';
      ctx.sfx.sting('clownhorn', { gain: 0.8 });
      ctx.ticker('The clowns pile back into the car');
      ctx.crowd('applause', 0.9);
    }
    // the car squashes and stretches as each clown squeezes out or in, and shakes while it idles
    A.bounce = Math.max(0, A.bounce - dt * 3);
    const sq = Math.sin(A.bounce * Math.PI) * 0.12;
    g.scale.set(1.25 * (1 + sq * 0.5), 1.25 * (1 - sq), 1.25 * (1 + sq * 0.5));
    g.rotation.z = 0.015 * Math.sin(A.t * 30) * (0.4 + A.speed / 3);
    A.engine.set(Math.min(1, 0.4 + A.speed / 3), 0.18 + 0.15 * Math.min(1, A.speed / 3));
  }

  /** the car as a solid thing and a mover */
  colliders() { return this.active ? [{ key: 'clowncar', pos: this.active.g.position, radius: 1.1, height: 1.5 }] : []; }
}
