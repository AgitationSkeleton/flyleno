// Freeing props that leave the scene. three.js keeps every geometry it has drawn (and its GPU buffers) until
// geometry.dispose() is called, so props that are built fresh for every visit (the frog, the car, stagehands,
// predators, falling rig pieces, splats...) must be disposed when they go, or memory grows all show long.
// Resources shared between many objects (the tomato geometry, Leno's head model, ...) are marked with keep()
// and are never freed. (Disposing a shared one by mistake is harmless: three.js re-uploads it on next use.)
import { lowOf } from './lod.js';

const MAPS = ['map', 'alphaMap', 'emissiveMap', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap', 'lightMap'];

/** mark a geometry, a material, or every geometry/material/texture in an object tree as shared (never disposed) */
export function keep(x) {
  if (!x) return x;
  const mark = (r) => { if (r) r.userData.keep = true; };
  const markMat = (m) => { mark(m); for (const k of MAPS) mark(m[k]); };
  if (x.isBufferGeometry) mark(x);
  else if (x.isMaterial) markMat(x);
  else if (x.traverse) x.traverse((o) => {
    if (o.geometry) mark(o.geometry);
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(markMat);
  });
  return x;
}

/** remove `root` from the scene and free its geometries, materials and textures (except shared ones) */
export function disposeObject(root) {
  if (!root) return;
  root.removeFromParent();
  const geos = new Set(), mats = new Set();
  root.traverse((o) => {
    if (o.geometry) { geos.add(o.geometry); if (o.userData.lodFull) geos.add(o.userData.lodFull); }
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
    if (o.isInstancedMesh) o.dispose();
  });
  for (const g of geos) {
    if (g.userData.keep) continue;
    const low = lowOf(g);
    if (low && !low.userData.keep) low.dispose();
    g.dispose();
  }
  for (const m of mats) {
    if (m.userData.keep) continue;
    for (const k of MAPS) if (m[k] && !m[k].userData.keep) m[k].dispose();
    m.dispose();
  }
}
