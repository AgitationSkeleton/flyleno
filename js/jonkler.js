// The Jonkler (a guest segment, like Mr. Frog): a purple-suited, green-haired, chalk-white clown with a red painted
// grin strolls on, points a toy revolver at Leno and pulls the trigger: out pops a "BANG!" flag on a stick. Nothing is
// fired, yet Leno is blown across the stage, and harder each time (the knockback doubles with every shot). The
// Jonkler cackles after each one, bows, and strolls off.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored, limb, FIGURE_SCALE, NECK } from './cultist-model.js';
import { keep } from './dispose.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = FIGURE_SCALE;
const PURPLE = 0x5b2a86, DARK_PURPLE = 0x3d1a5c, GREEN = 0x2e9a44, HAIR = 0x35b34f, SKIN = 0xf2f2ee, RED = 0xd0181c,
  ORANGE = 0xe0781e, SHOE = 0x23150c, EYE = 0x151515;
let mat = null, flagTex = null;

function flagTexture() {
  if (flagTex) return flagTex;
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#fbfbf6'; x.fillRect(0, 0, 256, 128);
  x.strokeStyle = '#d0181c'; x.lineWidth = 10; x.strokeRect(5, 5, 246, 118);
  x.fillStyle = '#d0181c'; x.font = 'bold 76px Impact, "Arial Black", sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('BANG!', 128, 68);
  flagTex = keep(new THREE.CanvasTexture(c)); flagTex.colorSpace = THREE.SRGBColorSpace;
  return flagTex;
}

/** the Jonkler, on the stagehands' rig (skirt, body, head, armL, armR, handOffset) plus .gun and .flag on the right hand */
export function jonklerFigure() {
  mat ||= keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.7, side: THREE.DoubleSide }));
  const mk = (geo) => { const m = new THREE.Mesh(geo.scale(S, S, S), mat); m.castShadow = true; return m; };
  const g = new THREE.Group();
  // trousers and shoes (origin at the waist)
  g.skirt = mk(mergeGeometries([
    ...[-1, 1].map((s) => limb(V(0.1 * s, 0, 0), V(0.12 * s, -0.66, 0.01), 0.1, 0.085, PURPLE, 8)),
    ...[-1, 1].map((s) => colored(new THREE.SphereGeometry(0.075, 8, 6).scale(1, 0.6, 1.9).translate(0.12 * s, -0.69, 0.06), SHOE)),
  ]));
  // purple jacket over a green waistcoat, an orange shirt and a green bow tie
  g.body = mk(mergeGeometries([
    colored(new THREE.CylinderGeometry(0.19, 0.24, 0.64, 10, 1).translate(0, 0.32, 0), PURPLE),
    colored(new THREE.BoxGeometry(0.2, 0.46, 0.06).translate(0, 0.32, 0.19), GREEN),
    colored(new THREE.ConeGeometry(0.06, 0.14, 4).rotateX(Math.PI).translate(0, 0.54, 0.19), ORANGE),
    ...[-1, 1].map((s) => colored(new THREE.ConeGeometry(0.035, 0.07, 4).rotateZ(s * Math.PI / 2).translate(0.035 * s, 0.6, 0.2), GREEN)),
    ...[-1, 1].map((s) => colored(new THREE.BoxGeometry(0.06, 0.3, 0.03).rotateZ(s * 0.25).translate(0.1 * s, 0.45, 0.2), DARK_PURPLE)),   // lapels
  ]));
  // chalk-white face, slicked-back green hair, dark eyes, a wide red grin with the corners painted up the cheeks
  g.head = mk(mergeGeometries([
    colored(new THREE.SphereGeometry(0.14, 12, 10).scale(0.95, 1.15, 1).translate(0, 0.15, 0), SKIN),
    colored(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.9, 1.15).rotateX(-0.35).translate(0, 0.19, -0.03), HAIR),
    ...[-1, 1].map((s) => colored(new THREE.SphereGeometry(0.03, 8, 6).scale(1.2, 1, 0.5).translate(0.05 * s, 0.19, 0.12), EYE)),
    colored(new THREE.TorusGeometry(0.07, 0.016, 5, 14, Math.PI).rotateZ(Math.PI).scale(1, 0.8, 1).translate(0, 0.1, 0.12), RED),
    ...[-1, 1].map((s) => colored(new THREE.CapsuleGeometry(0.012, 0.05, 3, 6).rotateZ(-s * 0.9).translate(0.085 * s, 0.13, 0.105), RED)),
  ]));
  g.head.position.copy(NECK).multiplyScalar(S);
  const arm = (side) => mk(mergeGeometries([
    limb(V(0, 0, 0), V(0.03 * side, -0.52, 0.04), 0.065, 0.075, PURPLE, 6),
    colored(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 1.1, 1.2).translate(0.03 * side, -0.59, 0.05), DARK_PURPLE),
  ]));
  g.armL = arm(1); g.armL.position.set(0.24 * S, 0.6 * S, 0);
  g.armR = arm(-1); g.armR.position.set(-0.24 * S, 0.6 * S, 0);
  g.skirt.position.y = 0.72 * S; g.body.position.y = 0.72 * S;
  g.body.add(g.head, g.armL, g.armR);
  g.add(g.skirt, g.body);
  g.handOffset = V(0.03, -0.58, 0.05).multiplyScalar(S);
  // the toy revolver in the right hand, along the arm (arm-local -y is "forward" once he points it)
  const gun = new THREE.Group(); gun.position.copy(g.handOffset);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2c2c30, metalness: 0.7, roughness: 0.35 }), wood = new THREE.MeshStandardMaterial({ color: 0x6b3f1f, roughness: 0.7 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.26, 10).translate(0, -0.15, 0.03), metal);
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.07, 10).translate(0, -0.03, 0.03), metal);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.06, 0.14).translate(0, 0.03, -0.04), wood);
  gun.add(barrel, drum, grip);
  // the BANG! flag: a stick out of the barrel with a banner hanging from its end (hidden until he fires)
  const flag = new THREE.Group(); flag.position.set(0, -0.28, 0.03);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 6).translate(0, -0.17, 0), new THREE.MeshStandardMaterial({ color: 0xeeeeee }));
  const banner = new THREE.Sprite(new THREE.SpriteMaterial({ map: flagTexture(), depthWrite: true }));
  banner.position.set(0, -0.3, -0.14); banner.scale.set(0.56, 0.28, 1);
  flag.add(rod, banner); flag.visible = false;
  gun.add(flag);
  g.armR.add(gun);
  g.gun = gun; g.flag = flag;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export class Jonkler {
  /** ctx: { npcs, sfx, center, stageRadius, getLeno() -> { pos }, onBang(shot, from), onLaugh(), ticker } */
  constructor(ctx) { this.ctx = ctx; this.npc = null; }

  get present() { return !!this.npc && !this.npc.done; }
  headPos() { return this.present ? this.npc.headPos() : null; }

  /** stroll on, fire the toy gun three times (a laugh after each), bow, stroll off */
  enter() {
    if (this.present) return false;
    const ctx = this.ctx, c = ctx.center, side = Math.random() < 0.5 ? -1 : 1;
    const wing = c.clone().add(V(side * 11, 0, -3));
    const leno = ctx.getLeno().pos;
    const toWing = wing.clone().sub(leno).setY(0).normalize();
    const spot = leno.clone().addScaledVector(toWing, 4.2);
    const fromC = spot.clone().sub(c).setY(0), lim = ctx.stageRadius * 0.72;
    if (fromC.length() > lim) spot.copy(c).addScaledVector(fromC.setLength(lim), 1);
    const fig = jonklerFigure();
    const faceLeno = (f) => { const d = ctx.getLeno().pos.clone().sub(f.position); f.rotation.y = Math.atan2(d.x, d.z); };
    const shots = [0, 1, 2];
    this.npc = ctx.npcs.scripted(fig, wing, (n) => [
      { type: 'walk', to: spot, within: 0.3, speed: 1.7 },
      ...shots.flatMap((k) => [
        // take aim: the arm comes up and points at him
        { type: 'pose', dur: 1.3, pose: (f, t) => { faceLeno(f); f.armR.rotation.x = -1.5 * Math.min(1, t / 0.45); f.body.rotation.x = -0.05; f.head.rotation.x = 0.1; } },
        // BANG: the flag pops out; nothing leaves the gun, yet he's blown away
        { type: 'pose', dur: 0.05, then: () => { fig.flag.visible = true; fig.flag.scale.set(1, 0.01, 1); n.flagT = 0; ctx.sfx.sting('bang', { gain: 0.9 }); ctx.onBang?.(k, fig.position.clone()); } },
        // hold it out for a moment, then cackle, leaning back
        { type: 'pose', dur: 2.4, pose: (f, t) => {
          faceLeno(f);
          fig.flag.scale.set(1, Math.min(1, 0.01 + t / 0.12), 1);
          f.armR.rotation.x = t < 0.8 ? -1.5 : -1.5 + Math.min(1, (t - 0.8) / 0.4) * 0.9;
          if (t > 0.35) { f.body.rotation.x = -0.25 + 0.07 * Math.sin(t * 26); f.head.rotation.x = -0.35 + 0.1 * Math.sin(t * 26); f.armL.rotation.set(-0.6, 0, 0.5); }
          if (t > 0.35 && !n['laughed' + k]) { n['laughed' + k] = true; ctx.sfx.sting('cackle', { gain: 0.6 }); ctx.onLaugh?.(); }
        }, then: () => { fig.flag.visible = false; } },
      ]),
      { type: 'pose', dur: 1.0, pose: (f, t) => { const b = Math.sin(Math.min(1, t) * Math.PI); f.body.rotation.x = 0.6 * b; f.head.rotation.x = 0.3 * b; f.armR.rotation.set(-0.4 * b, 0, 0); } },   // a bow
      { type: 'walk', to: wing, within: 0.5, speed: 1.9 },
      { type: 'pose', dur: 0.05, then: () => n.remove() },
    ]);
    ctx.ticker?.('The Jonkler strolls onto the stage');
    return true;
  }

  leave() { if (this.present) this.npc.remove(); this.npc = null; }
  clear() { this.leave(); }
}
