// Levels of detail for everything that isn't Leno or the seated audience (js/cultists.js has its own).
//
//   InstancedLOD - instanced set pieces (seats, toilets, truss, light cans): every instance is put into one
//                  of a few InstancedMeshes (full / mid / far geometry) by its distance from the camera,
//                  re-bucketed whenever the camera has moved.
//   PropLOD      - one-off props (the frog, the car, the goose, NPCs, predators, the UFO, balloons...): each of
//                  their meshes swaps to automatically simplified copies of its geometry as it gets small on screen
//                  (projected size): full -> mid (~60% of the vertices) -> far (~25%), and back when it's close
//                  again. Skinned and morphing meshes (Leno's head) and meshes flagged userData.noLOD (small but
//                  telling details, like the frog's eyes) keep their full geometry.
import * as THREE from 'three';
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const HYST = 0.1;                                        // 10% hysteresis so things don't flicker between levels

export class InstancedLOD {
  /**
   * tracks: [{ mesh: InstancedMesh (becomes level 0), levels: [geometry | null, ...] }] - all tracks share the
   * same instance layout (e.g. a seat's fabric and its frame); null = not drawn at that level.
   * dists: level boundaries in metres, e.g. [12, 26] -> near < 12 <= mid < 26 <= far.
   */
  constructor(tracks, dists) {
    this.dists = dists;
    const first = tracks[0].mesh, n = first.count;
    this.n = n;
    this.matrices = Array.from({ length: n }, (_, i) => { const m = new THREE.Matrix4(); first.getMatrixAt(i, m); return m; });
    this.centers = this.matrices.map((m) => new THREE.Vector3().setFromMatrixPosition(m));
    this.level = new Uint8Array(n);
    this.tracks = tracks.map(({ mesh, levels }) => {
      const meshes = [mesh, ...levels.map((geo, k) => {
        if (!geo) return null;
        const im = new THREE.InstancedMesh(geo, mesh.material, n);
        im.name = `${mesh.name}_lod${k + 1}`; im.castShadow = mesh.castShadow; im.receiveShadow = mesh.receiveShadow;
        im.count = 0; im.frustumCulled = false;
        mesh.parent.add(im);
        return im;
      })];
      // each track's own matrices (they can differ from the first track's, e.g. lenses vs cans)
      const mats = Array.from({ length: n }, (_, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; });
      mesh.frustumCulled = false;
      return { meshes, mats };
    });
    this.lastEye = null;
    this.counts = [];
  }

  update(eye) {
    if (this.lastEye && this.lastEye.distanceToSquared(eye) < 0.25 * 0.25) return;
    this.lastEye = (this.lastEye || new THREE.Vector3()).copy(eye);
    const L = this.dists.length;
    for (let i = 0; i < this.n; i++) {
      const d = this.centers[i].distanceTo(eye);
      let l = this.level[i];
      while (l < L && d > this.dists[l] * (1 + HYST)) l++;
      while (l > 0 && d < this.dists[l - 1] * (1 - HYST)) l--;
      this.level[i] = l;
    }
    const counts = new Array(L + 1).fill(0);
    for (const t of this.tracks) {
      const c = new Array(L + 1).fill(0);
      for (let i = 0; i < this.n; i++) {
        const l = this.level[i], m = t.meshes[l];
        if (m) m.setMatrixAt(c[l]++, t.mats[i]);
      }
      t.meshes.forEach((m, l) => { if (m) { m.count = c[l]; m.instanceMatrix.needsUpdate = true; } });
      if (t === this.tracks[0]) c.forEach((x, l) => (counts[l] = x));
    }
    this.counts = counts;
  }
}

// ------------------------------------------------------------------------------------------------ props
const simplifier = new SimplifyModifier();
const lowCache = new WeakMap();                          // full geometry -> Map(keep -> simplified copy)
const MID = 0.05, FAR = 0.02;                            // projected sizes (~angular radius) where the levels switch

function triangles(g) { return (g.index ? g.index.count : g.attributes.position.count) / 3; }

/** every cached simplified copy of `geo` */
export function lowsOf(geo) { return [...(lowCache.get(geo)?.values() ?? [])].filter(Boolean); }

/** a simplified copy keeping ~`keep` of the vertices (normals recomputed; flat-shaded materials ignore them) */
export function simplified(geo, keep = 0.3) {
  let byKeep = lowCache.get(geo);
  if (!byKeep) lowCache.set(geo, (byKeep = new Map()));
  if (byKeep.has(keep)) return byKeep.get(keep);
  let low = null;
  try {
    let g = geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
    g.morphAttributes = {};
    g = mergeVertices(g, 1e-4);
    const remove = Math.floor(g.attributes.position.count * (1 - keep));
    low = remove > 8 ? simplifier.modify(g, remove) : g;
    low.computeVertexNormals();
    if (triangles(low) >= triangles(geo) * 0.9) low = null;   // not worth it
  } catch (e) { low = null; }
  byKeep.set(keep, low);
  return low;
}

export class PropLOD {
  constructor() { this.items = []; this.t = 0; this.stats = { far: 0, near: 0 }; }

  /**
   * Track every eligible mesh under `root`. opts.center(): world position to measure from (instanced meshes);
   * opts.mid / opts.far: fraction of vertices kept at medium / far distance; opts.minTris: skip meshes smaller than this.
   */
  track(root, { mid = 0.6, far = 0.25, minTris = 120, center = null, size = null } = {}) {
    root.traverse((o) => {
      if (!o.isMesh || o.isSkinnedMesh || o.userData.noLOD) return;
      const g = o.geometry;
      if (!g?.attributes.position || Object.keys(g.morphAttributes || {}).length || triangles(g) < minTris) return;
      const m = simplified(g, mid), f = simplified(g, far) ?? m;
      if (!m && !f) return;
      if (!g.boundingSphere) g.computeBoundingSphere();
      o.userData.lodFull = g;                                // so disposal frees the full geometry even while a low one shows
      this.items.push({ mesh: o, root, levels: [g, m ?? g, f ?? m ?? g], level: 0, center, size });
    });
    return root;
  }

  /** call every frame; re-evaluates a few times a second */
  update(camera, dt) {
    this.t += dt;
    if (this.t < 0.2) return;
    this.t = 0;
    const eye = camera.position, p = new THREE.Vector3(), s = new THREE.Vector3();
    let far = 0;
    this.items = this.items.filter((it) => {
      // drop props that have left the scene
      let o = it.mesh; while (o.parent) o = o.parent;
      if (!o.isScene) return false;
      if (it.center) p.copy(it.center()); else it.mesh.getWorldPosition(p);
      it.mesh.getWorldScale(s);
      const r = (it.size ?? it.levels[0].boundingSphere.radius) * Math.max(s.x, s.y, s.z);
      const size = r / Math.max(0.1, p.distanceTo(eye));      // ~ angular radius
      let l = it.level;                                       // 0 full, 1 mid, 2 far (with hysteresis)
      if (l === 0 && size < MID * (1 - HYST)) l = 1;
      if (l === 1 && size > MID * (1 + HYST)) l = 0;
      if (l === 1 && size < FAR * (1 - HYST)) l = 2;
      if (l === 2 && size > FAR * (1 + HYST)) l = 1;
      it.level = l;
      const want = it.levels[l];
      if (it.mesh.geometry !== want) it.mesh.geometry = want;
      if (l === 2) far++;
      return true;
    });
    this.stats = { far, near: this.items.length - far };
  }
}

/** the one registry the props use */
export const propLOD = new PropLOD();
