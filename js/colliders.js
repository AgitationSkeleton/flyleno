// Collision for the auditorium and everything in it (shared Rapier world of the ragdoll / Fly-Leno):
//   * every static set mesh -> a fixed trimesh (walls, curtains, risers, LED strips, props, letters, screens...)
//   * instanced set pieces (toilets, truss, light cans) -> one oriented box per instance
//   * room bounds: invisible walls around the actual set (the studio floor mesh is much larger than the room)
//   * moving entities (stagehand, heckler, goose, hatchlings) -> kinematic capsules that follow them
import * as THREE from 'three';

const G = ((1 & 0xffff) << 16) | 0xffff;          // "ground" group: collides with everything
const SKIP = /^(StudioFloor|MarkerHelpers|SeatsFabric|SeatsFrame|LightLenses)$/;   // floor is ground; seats have row boxes
const INSTANCED_BOXES = /^(Toilets|Truss|LightCans)$/;

export function addSetColliders(R, world, stage) {
  const skip = new Set(stage.ground);
  const content = new THREE.Box3();
  let tris = 0, boxes = 0;
  stage.root.updateMatrixWorld(true);
  stage.root.traverse((o) => {
    if (!o.isMesh || skip.has(o) || SKIP.test(o.name) || o.parent?.name === 'MarkerHelpers') return;
    const geo = o.geometry;
    if (o.isInstancedMesh) {
      if (!INSTANCED_BOXES.test(o.name)) return;
      geo.computeBoundingBox();
      const bb = geo.boundingBox, c = bb.getCenter(new THREE.Vector3()), h = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
      const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); m.decompose(p, q, s);
        const center = c.clone().multiply(s).applyQuaternion(q).add(p);
        world.createCollider(R.ColliderDesc.cuboid(Math.max(0.02, h.x * Math.abs(s.x)), Math.max(0.02, h.y * Math.abs(s.y)), Math.max(0.02, h.z * Math.abs(s.z)))
          .setTranslation(center.x, center.y, center.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(G));
        boxes++;
      }
      return;
    }
    const g = geo.index ? geo.toNonIndexed() : geo;
    const pos = g.attributes.position;
    if (!pos || pos.count < 3) return;
    const V = new Float32Array(pos.count * 3), I = new Uint32Array(pos.count), v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld); V[i * 3] = v.x; V[i * 3 + 1] = v.y; V[i * 3 + 2] = v.z; I[i] = i; }
    world.createCollider(R.ColliderDesc.trimesh(V, I).setCollisionGroups(G));
    tris += pos.count / 3;
    if (o.name !== 'Ceiling') content.expandByObject(o);
  });
  // room bounds just outside the set, up to the ceiling
  const floorY = Math.min(...stage.ground.map((m) => new THREE.Box3().setFromObject(m).min.y));
  const cz = content.getCenter(new THREE.Vector3()), sz = content.getSize(new THREE.Vector3());
  const top = Math.max(content.max.y, 20) + 2, T = 1, pad = 1.5;
  const hx = sz.x / 2 + pad, hz = sz.z / 2 + pad, hy = (top - floorY) / 2, cy = (top + floorY) / 2;
  for (const [x, z, ex, ez] of [[cz.x - hx - T, cz.z, T, hz + T], [cz.x + hx + T, cz.z, T, hz + T], [cz.x, cz.z - hz - T, hx + T, T], [cz.x, cz.z + hz + T, hx + T, T]]) {
    world.createCollider(R.ColliderDesc.cuboid(ex, hy, ez).setTranslation(x, cy, z).setCollisionGroups(G));
  }
  world.createCollider(R.ColliderDesc.cuboid(hx + T, T, hz + T).setTranslation(cz.x, top + T, cz.z).setCollisionGroups(G));   // lid
  const room = new THREE.Box3(new THREE.Vector3(cz.x - hx, floorY, cz.z - hz), new THREE.Vector3(cz.x + hx, top, cz.z + hz));
  return { tris, boxes, room };
}

/** kinematic capsules that follow moving entities: sync([{ key, pos, radius, height }]) every frame */
export class EntityColliders {
  constructor(R, world) { this.R = R; this.world = world; this.map = new Map(); }

  sync(list) {
    const seen = new Set();
    for (const e of list) {
      seen.add(e.key);
      let c = this.map.get(e.key);
      if (!c) {
        const body = this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased().setTranslation(e.pos.x, e.pos.y + e.height / 2, e.pos.z));
        this.world.createCollider(this.R.ColliderDesc.capsule(Math.max(0.01, e.height / 2 - e.radius), e.radius).setCollisionGroups(G), body);
        c = { body }; this.map.set(e.key, c);
      }
      c.body.setNextKinematicTranslation({ x: e.pos.x, y: e.pos.y + e.height / 2, z: e.pos.z });
    }
    for (const [k, c] of this.map) if (!seen.has(k)) { this.world.removeRigidBody(c.body); this.map.delete(k); }
  }
}
