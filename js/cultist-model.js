// Low-poly robed figure: a deep rounded cowl (no point), a white theatre mask set back inside the hood,
// a robe that drapes from the shoulders, and jointed sleeves ending in pale hands.
// Used for the seated audience (instanced) and the standing stagehand / heckler (animated groups).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const FIGURE_SCALE = 1.35;
export const NECK = new THREE.Vector3(0, 0.72, 0);     // head pivot (unscaled, seated origin = seat surface)

export const PALETTES = {
  audience: { robe: 0x1b1a20, hood: 0x121214, lining: 0x060607, trim: 0x2a2830, mask: 0xeeeae2, eye: 0x050505, hand: 0xd9d2c5 },
  stagehand: { robe: 0x2f3338, hood: 0x24272b, lining: 0x0a0b0c, trim: 0x5e5530, mask: 0xeeeae2, eye: 0x050505, hand: 0xd9d2c5 },
  heckler: { robe: 0x3a0d10, hood: 0x2a0709, lining: 0x080203, trim: 0xb0161c, mask: 0xf2eee6, eye: 0x050505, hand: 0xd9d2c5 },
};

export function colored(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

/** tapered cylinder from p0 to p1 */
export function limb(p0, p1, r0, r1, hex, seg = 6) {
  const d = p1.clone().sub(p0), L = d.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  g.translate((p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2);
  return colored(g, hex);
}

/** head geometry around the neck pivot (0,0,0) */
export function headGeometry(P) {
  const parts = [];
  // cowl: a sphere with a wide opening at the front (+Z), slightly deeper than tall, falling onto the shoulders
  const cowl = new THREE.SphereGeometry(0.2, 12, 9, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.78);
  cowl.scale(1.05, 1.18, 1.18).translate(0, 0.13, -0.015);
  parts.push(colored(cowl, P.hood));
  // dark lining visible inside the opening
  const lining = new THREE.SphereGeometry(0.185, 10, 8, Math.PI * 0.62, Math.PI * 1.76, 0, Math.PI * 0.8);
  lining.scale(-1.0, 1.15, 1.12).translate(0, 0.13, -0.02);   // mirrored so its faces point inward
  parts.push(colored(lining, P.lining));
  // the hood's rim folds (a flattened torus around the face opening)
  const rim = new THREE.TorusGeometry(0.15, 0.022, 5, 14, Math.PI * 1.55).rotateZ(-Math.PI * 0.275).scale(1, 1.22, 1).translate(0, 0.12, 0.155);
  parts.push(colored(rim, P.hood));
  // white theatre mask, recessed inside the cowl
  parts.push(colored(new THREE.SphereGeometry(0.115, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62).rotateX(Math.PI / 2)
    .scale(0.95, 1.32, 0.55).translate(0, 0.11, 0.095), P.mask));
  // eye holes and mouth slit
  for (const x of [-0.042, 0.042]) parts.push(colored(new THREE.SphereGeometry(0.022, 6, 4).scale(1.3, 0.75, 0.5).translate(x, 0.15, 0.158), P.eye));
  parts.push(colored(new THREE.BoxGeometry(0.05, 0.012, 0.02).translate(0, 0.055, 0.155), P.eye));
  return mergeGeometries(parts);
}

/** one arm (sleeve + hand) with its pivot at the shoulder (0,0,0), for animated figures; `side` = +1 left, -1 right */
export function armGeometry(P, side, pose = 'down') {
  const sh = new THREE.Vector3(0, 0, 0);
  const el = pose === 'lap' ? new THREE.Vector3(0.03 * side, -0.27, 0.09) : new THREE.Vector3(0.04 * side, -0.3, 0.02);
  const ha = pose === 'lap' ? new THREE.Vector3(-0.05 * side, -0.37, 0.3) : new THREE.Vector3(0.03 * side, -0.58, 0.05);
  const parts = [
    limb(sh, el, 0.075, 0.08, P.robe),
    limb(el, ha, 0.08, 0.1, P.robe),                                       // widening sleeve
    // hand just past the cuff, along the forearm direction
    colored(new THREE.SphereGeometry(0.058, 7, 5).scale(1, 1.15, 1.25).translate(...ha.clone().add(ha.clone().sub(el).normalize().multiplyScalar(0.045)).toArray()), P.hand),
  ];
  return mergeGeometries(parts);
}

/** torso/robe (seated or standing), origin = seat surface (seated) or the floor under the figure (standing, shifted) */
export function bodyGeometry(P, seated, part = 'all') {
  const parts = [];
  if (part === 'skirt') {
    // standing figure's lower robe: stays put while the torso bends at the waist; the band hides the seam
    parts.push(colored(new THREE.CylinderGeometry(0.3, 0.38, 0.72, 10, 1).translate(0, -0.36, -0.02), P.robe));
    parts.push(colored(new THREE.SphereGeometry(0.3, 10, 6).scale(1, 0.45, 1).translate(0, 0, -0.02), P.robe));
    return mergeGeometries(parts);
  }
  parts.push(colored(new THREE.CylinderGeometry(0.17, 0.3, 0.62, 9, 1).translate(0, 0.31, -0.02), P.robe));        // torso
  parts.push(colored(new THREE.CylinderGeometry(0.2, 0.31, 0.16, 9, 1).translate(0, 0.6, -0.01), P.trim));        // sloped mantle over the shoulders
  // the hood's drape belongs to the torso (it must not swing with the head): a collar the head turns inside
  parts.push(colored(new THREE.CylinderGeometry(0.17, 0.26, 0.2, 10, 1, true).translate(0, NECK.y - 0.04, -0.02), P.hood));
  if (seated) {
    parts.push(colored(new THREE.BoxGeometry(0.46, 0.14, 0.42).translate(0, 0.02, 0.2), P.robe));                  // lap
    parts.push(colored(new THREE.CylinderGeometry(0.22, 0.28, 0.45, 9, 1).translate(0, -0.2, 0.36), P.hood));      // robe to floor
  } else if (part === 'all') {
    parts.push(colored(new THREE.CylinderGeometry(0.3, 0.38, 0.72, 10, 1).translate(0, -0.36, -0.02), P.robe));    // skirt to floor
  }
  return mergeGeometries(parts);
}

const SH_L = new THREE.Vector3(0.24, 0.6, 0), SH_R = new THREE.Vector3(-0.24, 0.6, 0);

/** seated audience member: { body (incl. arms resting on the lap), head (pivot at neck) }, scaled */
export function seatedGeometry(P = PALETTES.audience) {
  const body = mergeGeometries([
    bodyGeometry(P, true),
    armGeometry(P, 1, 'lap').translate(SH_L.x, SH_L.y, SH_L.z),
    armGeometry(P, -1, 'lap').translate(SH_R.x, SH_R.y, SH_R.z),
  ]).scale(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE);
  const head = headGeometry(P).scale(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE);
  body.computeVertexNormals(); head.computeVertexNormals();
  return { body, head };
}

/** standing, animatable figure as a THREE.Group (origin at the feet): .skirt (static), .body (torso, pivots at the
 *  waist) carrying .head (neck pivot) and .armL/.armR (shoulder pivots), so bending the body takes hood and arms along */
export function standingFigure(P, mat) {
  const g = new THREE.Group();
  const lift = 0.72;                                   // skirt reaches the floor; the waist is at `lift`
  const mk = (geo) => { const m = new THREE.Mesh(geo.scale(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE), mat); m.castShadow = true; return m; };
  g.skirt = mk(bodyGeometry(P, false, 'skirt')); g.skirt.position.y = lift * FIGURE_SCALE;
  g.body = mk(bodyGeometry(P, false, 'torso')); g.body.position.y = lift * FIGURE_SCALE;
  g.head = mk(headGeometry(P)); g.head.position.copy(NECK).multiplyScalar(FIGURE_SCALE);
  g.armL = mk(armGeometry(P, 1)); g.armL.position.copy(SH_L).multiplyScalar(FIGURE_SCALE);
  g.armR = mk(armGeometry(P, -1)); g.armR.position.copy(SH_R).multiplyScalar(FIGURE_SCALE);
  g.body.add(g.head, g.armL, g.armR);
  g.add(g.skirt, g.body);
  g.handOffset = new THREE.Vector3(0.03, -0.58, 0.05).multiplyScalar(FIGURE_SCALE);   // hand in arm-local space
  return g;
}

export function figureMaterial() {
  return new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0, side: THREE.DoubleSide });
}
