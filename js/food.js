// Food in the world: sugar cubes (brought by the stagehand) and tomato pulp (thrown tomatoes that burst
// on the floor). Leno can taste and eat them like a fly: see js/instincts.js.
import * as THREE from 'three';

export class Food {
  constructor(scene) {
    this.scene = scene;
    this.items = [];
    this.pulpGeo = new THREE.IcosahedronGeometry(0.16, 1);
    this.pulpMat = new THREE.MeshStandardMaterial({ color: 0xb3180f, roughness: 0.8 });
  }

  addSugar(pos, mesh) {
    if (mesh) { mesh.position.copy(pos); mesh.rotation.set(0, Math.random() * 6, 0); this.scene.add(mesh); }
    this.items.push({ kind: 'sugar', pos: pos.clone(), amount: 1, mesh, sweet: 1 });
  }

  addTomato(pos) {
    const mesh = new THREE.Mesh(this.pulpGeo, this.pulpMat);
    mesh.scale.set(1.1, 0.35, 1.1); mesh.position.copy(pos).add(new THREE.Vector3(0, 0.03, 0));
    this.scene.add(mesh);
    this.items.push({ kind: 'tomato', pos: pos.clone(), amount: 0.7, mesh, sweet: 0.6 });
    while (this.items.filter((i) => i.kind === 'tomato').length > 12) this.remove(this.items.find((i) => i.kind === 'tomato'));
  }

  /** the rotten éclair: sweet, but it doesn't stay down ("it's the rotten éclair again") */
  addEclair(pos, mesh) {
    if (mesh) { mesh.position.copy(pos); mesh.rotation.set(0, Math.random() * 6, 0); this.scene.add(mesh); }
    this.items.push({ kind: 'éclair', pos: pos.clone(), amount: 1, mesh, sweet: 0.9, rotten: true });
  }

  /** a power-up mushroom: irresistible (sought even when not hungry); returns the item so its position can follow the mesh */
  addMushroom(pos, mesh) {
    const item = { kind: 'mushroom', pos: pos.clone(), amount: 0.6, mesh, sweet: 1, eager: true, base: mesh.scale.x, grow: true };
    this.items.push(item);
    return item;
  }

  /** goose droppings: only Fly-Leno is interested */
  addPoop(pos, mesh) {
    mesh.position.copy(pos); this.scene.add(mesh);
    this.items.push({ kind: 'poop', pos: pos.clone(), amount: 0.35, mesh, sweet: 0.9, base: mesh.scale.x });
    while (this.items.filter((i) => i.kind === 'poop').length > 40) this.remove(this.items.find((i) => i.kind === 'poop'));
  }

  nearest(p, maxDist = Infinity, accept = null) {
    let best = null, bd = maxDist;
    for (const it of this.items) {
      if (accept && !accept(it)) continue;
      const d = Math.hypot(it.pos.x - p.x, it.pos.z - p.z);
      if (d < bd && Math.abs(it.pos.y - p.y) < 1.5) { bd = d; best = it; }
    }
    return best ? { item: best, dist: bd } : null;
  }

  /** take a bite; returns true when the item is finished */
  eat(item, amount) {
    item.amount -= amount;
    const s = Math.max(0.05, item.amount);
    if (item.mesh && item.kind === 'poop') item.mesh.scale.setScalar(item.base * (0.3 + 0.7 * s / 0.35));
    else if (item.mesh && item.kind === 'mushroom') item.mesh.scale.setScalar(item.base * (0.35 + 0.65 * s / 0.6));
    else if (item.mesh && item.rotten) item.mesh.scale.setScalar(0.35 + 0.65 * s);
    else if (item.mesh) item.mesh.scale.setScalar(item.kind === 'sugar' ? Math.cbrt(s) : 1).multiply(item.kind === 'tomato' ? new THREE.Vector3(1.1 * s + 0.2, 0.35, 1.1 * s + 0.2) : new THREE.Vector3(1, 1, 1));
    if (item.amount <= 0) { this.remove(item); return true; }
    return false;
  }

  remove(item) {
    if (item.mesh) this.scene.remove(item.mesh);
    this.items.splice(this.items.indexOf(item), 1);
  }

  clear() { for (const it of [...this.items]) this.remove(it); }
}
