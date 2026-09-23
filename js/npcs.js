// Walking show characters built from the robed figure (js/cultist-model.js):
//   stagehand - grey robe, gold mantle: walks on from the wings carrying a sugar cube, sets it down near Leno, leaves
//   heckler   - red robe: gets up from an audience seat, charges toward Leno, then either rants with both arms
//               raised or pelts him with tomatoes/pipes, and goes back to its seat
// Movement is simple steering on the ground (ray cast to the stage/floor meshes).
import * as THREE from 'three';
import { standingFigure, figureMaterial, PALETTES, FIGURE_SCALE } from './cultist-model.js';

const WALK = 2.2, RUN = 4.2;             // m/s (stage units)
const down = new THREE.Vector3(0, -1, 0);

class Npc {
  constructor(world, palette) {
    this.world = world;
    this.fig = standingFigure(palette, world.mat);
    world.scene.add(this.fig);
    this.plan = [];                       // queue of steps
    this.t = 0; this.phase = Math.random() * 6;
    this.speed = 0;
    this.done = false;
  }

  at(p) { this.fig.position.copy(p); this.fig.position.y = this.world.groundAt(p) ?? p.y; return this; }

  headPos() { return this.fig.position.clone().add(new THREE.Vector3(0, 2.0 * FIGURE_SCALE / 1.35, 0)); }

  update(dt) {
    const f = this.fig, step = this.plan[0];
    this.t += dt;
    let moving = false;
    // reset pose
    f.armL.rotation.set(0, 0, 0); f.armR.rotation.set(0, 0, 0); f.body.rotation.set(0, 0, 0); f.head.rotation.set(0, 0, 0);
    if (!step) { this.done = true; return; }
    if (step.type === 'walk') {
      const to = typeof step.to === 'function' ? step.to() : step.to;
      const d = to.clone().sub(f.position).setY(0);
      const dist = d.length();
      if (dist < (step.within ?? 0.3)) { this.plan.shift(); step.then?.(); }
      else {
        const v = Math.min(step.speed ?? WALK, dist * 3);
        f.position.addScaledVector(d.normalize(), v * dt);
        const gy = this.world.groundAt(f.position);
        if (gy !== null) f.position.y += (gy - f.position.y) * Math.min(1, dt * 12);
        const yaw = Math.atan2(d.x, d.z);
        let dy = yaw - f.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        f.rotation.y += dy * Math.min(1, dt * 8);
        moving = true; this.speed = v;
      }
    } else if (step.type === 'face') {
      const d = step.to().clone().sub(f.position);
      f.rotation.y = Math.atan2(d.x, d.z);
      this.plan.shift();
    } else {
      step.t = (step.t ?? 0) + dt;
      step.pose?.(f, step.t);
      if (step.t >= step.dur) { this.plan.shift(); step.then?.(); }
    }
    if (moving) {
      // walk cycle: body bob, arm swing
      const k = this.speed / WALK;
      this.phase += dt * 7 * Math.max(0.6, k);
      f.body.position.y = 0.72 * FIGURE_SCALE + Math.abs(Math.sin(this.phase)) * 0.05 * k;
      if (!this.carrying) f.armL.rotation.x = Math.sin(this.phase) * 0.5 * k;
      f.armR.rotation.x = -Math.sin(this.phase) * 0.5 * k;
    }
    if (this.carrying) f.armL.rotation.x = -1.2;                     // holding the cube out in front
  }

  remove() { this.world.scene.remove(this.fig); this.done = true; }
}

export class Npcs {
  constructor(scene, stage, { food, cultists, audio, onEvent, throwFrom }) {
    this.scene = scene; this.stage = stage; this.food = food; this.cultists = cultists; this.audio = audio;
    this.throwFrom = throwFrom;        // (kind, fromPosition) => void : throws at Leno
    this.onEvent = onEvent;
    this.mat = figureMaterial();
    this.list = [];
    this.ray = new THREE.Raycaster();
    this.cubeGeo = new THREE.BoxGeometry(0.11, 0.11, 0.11).scale(FIGURE_SCALE, FIGURE_SCALE, FIGURE_SCALE);
    this.cubeMat = new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.6 });
    const c = stage.markers.stageCenter.position;
    this.center = new THREE.Vector3(c[0], c[1], c[2]);
  }

  groundAt(p) {
    this.ray.set(new THREE.Vector3(p.x, p.y + 4, p.z), down); this.ray.far = 12;
    const hit = this.ray.intersectObjects(this.stage.ground, false)[0];
    return hit ? hit.point.y : null;
  }

  get busy() { return this.list.length > 0; }

  /** a rotten éclair: choux pastry, chocolate glaze, a patch of mould */
  eclairMesh() {
    if (!this.eclairParts) {
      const S = FIGURE_SCALE;
      this.eclairParts = [
        [new THREE.CapsuleGeometry(0.045, 0.16, 4, 8).rotateZ(Math.PI / 2).scale(S, S, S), new THREE.MeshStandardMaterial({ color: 0xd9a55b, roughness: 0.8 })],
        [new THREE.CapsuleGeometry(0.047, 0.15, 4, 8).rotateZ(Math.PI / 2).scale(S, 0.55 * S, S).translate(0, 0.02 * S, 0), new THREE.MeshStandardMaterial({ color: 0x3b2314, roughness: 0.3 })],
        [new THREE.SphereGeometry(0.025, 6, 4).scale(S, 0.4 * S, S).translate(0.04 * S, 0.045 * S, 0.01 * S), new THREE.MeshStandardMaterial({ color: 0x7c9a3a, roughness: 1 })],
      ];
    }
    const g = new THREE.Group();
    for (const [geo, mat] of this.eclairParts) g.add(new THREE.Mesh(geo, mat));
    return g;
  }

  /** stagehand brings a sugar cube (or the rotten éclair) and sets it on the floor in front of Leno */
  deliverSnack(getLeno, kind = 'sugar') {
    const side = Math.random() < 0.5 ? -1 : 1;
    const wing = this.center.clone().add(new THREE.Vector3(side * 11, 0, -4));
    const n = new Npc(this, PALETTES.stagehand).at(wing);
    const cube = kind === 'eclair' ? this.eclairMesh() : new THREE.Mesh(this.cubeGeo, this.cubeMat);
    n.fig.armL.add(cube); cube.position.copy(n.fig.handOffset).add(new THREE.Vector3(0, -0.08, 0.06));
    n.carrying = true;
    const drop = () => {
      const L = getLeno();
      const toward = n.fig.position.clone().sub(L.pos).setY(0).normalize();
      return L.pos.clone().addScaledVector(toward, 1.4);
    };
    n.plan.push(
      { type: 'walk', to: drop, within: 0.4 },
      { type: 'face', to: () => getLeno().pos },
      { type: 'pose', dur: 1.1, pose: (f, t) => { const k = Math.sin(Math.min(1, t / 1.1) * Math.PI); f.body.rotation.x = 0.5 * k; f.head.rotation.x = 0.4 * k; f.armL.rotation.x = -0.6 - 0.8 * k; },
        then: () => {
          const p = new THREE.Vector3(); cube.getWorldPosition(p);
          n.fig.armL.remove(cube); n.carrying = false;
          p.y = (this.groundAt(p) ?? p.y) + (kind === 'eclair' ? 0.05 : 0.075) * FIGURE_SCALE;
          if (kind === 'eclair') { this.food.addEclair(p, cube); this.onEvent?.('A stagehand sets down an éclair. It smells a little off.'); }
          else { this.food.addSugar(p, cube); this.onEvent?.('A stagehand sets down a sugar cube'); }
        } },
      { type: 'pose', dur: 0.6, pose: (f) => { f.armR.rotation.z = -0.4; f.armR.rotation.x = -1.4; } },     // a little wave
      { type: 'walk', to: wing, within: 0.5 },
      { type: 'pose', dur: 0.1, then: () => n.remove() },
    );
    this.list.push(n);
    this.onEvent?.(kind === 'eclair' ? 'A stagehand walks on with an éclair' : 'A stagehand walks on with a sugar cube');
  }

  /** a red-robed audience member storms toward Leno, shakes a fist and yells, then goes back to their seat */
  heckle(getLeno, mode = null) {
    const pelt = mode ? mode === 'pelt' : Math.random() >= 0.5;
    const seats = this.cultists.seats;
    const i = (Math.random() * seats.length) | 0;
    const seatPos = seats[i].p.clone();
    this.cultists.setHidden(i, true);
    const n = new Npc(this, PALETTES.heckler).at(seatPos.clone().add(new THREE.Vector3(0, 0, 0.8)));
    n.heckler = true;
    const target = () => {
      const L = getLeno();
      const away = seatPos.clone().sub(L.pos).setY(0).normalize();
      return L.pos.clone().addScaledVector(away, 2.6);
    };
    n.plan.push(
      { type: 'walk', to: target, within: 0.5, speed: RUN },
      { type: 'face', to: () => getLeno().pos },
      ...(!pelt || !this.throwFrom ? [
        // rant: both arms raised overhead, shaking, yelling
        { type: 'pose', dur: 2.4, pose: (f, t) => {
          const shake = 0.3 * Math.sin(t * 15);
          f.armL.rotation.set(-3.05 + shake, 0, 0.3); f.armR.rotation.set(-3.05 - shake, 0, -0.3);   // straight up
          f.body.rotation.x = -0.15 + 0.08 * Math.sin(t * 8); f.head.rotation.x = -0.25;
          if (!n.yelled) { n.yelled = true; this.audio.crowd('boo', { gain: 0.9 }); }
        } },
      ] : Array.from({ length: 3 + ((Math.random() * 3) | 0) }, (_, k) => ({
        // pelting: wind up and throw overarm, a tomato or (sometimes) a pipe per throw
        type: 'pose', dur: 0.75, pose: (f, t) => {
          const u = t / 0.75;
          f.armR.rotation.set(u < 0.55 ? -2.6 * (u / 0.55) - 0.4 : -3.0 + 3.4 * ((u - 0.55) / 0.45), 0, -0.15);
          f.armL.rotation.set(-0.5, 0, 0.2);
          f.body.rotation.x = u < 0.55 ? -0.2 : 0.25;
          if (u > 0.6 && !n['threw' + k]) {
            n['threw' + k] = true;
            const hand = new THREE.Vector3(); f.armR.localToWorld(hand.copy(f.handOffset));
            this.throwFrom(Math.random() < 0.75 ? 'tomato' : 'pipe', hand.add(new THREE.Vector3(0, 0.3, 0)));
            if (k === 0) this.audio.crowd('boo', { gain: 0.8 });
          }
        } }))),
      { type: 'walk', to: seatPos.clone().add(new THREE.Vector3(0, 0, 0.8)), within: 0.5, speed: WALK },
      { type: 'pose', dur: 0.1, then: () => { n.remove(); this.cultists.setHidden(i, false); } },
    );
    this.list.push(n);
    this.onEvent?.('A heckler storms the stage!');
  }

  /** heads of NPCs that are approaching Leno (for the fly's looming detectors) */
  approaching() { return this.list.filter((n) => n.heckler && !n.done).map((n) => n.headPos()); }

  update(dt) {
    for (const n of this.list) n.update(dt);
    this.list = this.list.filter((n) => !n.done);
  }
}
