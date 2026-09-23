// Random happenings on the TUURD Talk stage (engineered, like the goose):
//   Rapture      - the trumpet sounds; every seated audience member (not Leno) is taken up into the light, and the
//                  seats fill with babies, who grow back into their grown cultist selves in real time
//   RainCloud    - a personal storm cloud follows Leno and rains on him (touch, water on the antennae, low
//                  dopamine); lightning and thunder
//   VineMushroom - a Vinesauce-tomato-styled power-up mushroom falls from the ceiling and slides about; eating it
//                  is a big dopamine reward
//   rig drops    - studio cameras and stage lights fall from the ceiling (physics objects, js/projectiles.js)
//   MiniAliens   - dozens of little grey aliens walk up and kick him in the shins ("TOES", "mimimi")
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rand = (a, b) => a + Math.random() * (b - a);

function col(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo, c = new THREE.Color(hex), n = g.attributes.position.count;
  const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); if (g.attributes.uv) g.deleteAttribute('uv'); return g;
}

// ------------------------------------------------------------------------------------------------ Rapture
const GROW_SECONDS = 100;                  // babies grow back into adults over ~1.5 minutes

export class Rapture {
  constructor(ctx) {
    this.ctx = ctx; this.phase = null;
    const seats = ctx.cultists.seats, box = new THREE.Box3();
    for (const s of seats) box.expandByPoint(s.p);
    const c = box.getCenter(V()), size = box.getSize(V());
    // the light from above: a glowing column over the audience and a warm wash
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(size.x, size.z) * 0.45, Math.max(size.x, size.z) * 0.6, 40, 32, 1, true), this.beamMat);
    this.beam.position.set(c.x, c.y + 18, c.z); this.beam.visible = false;
    this.glow = new THREE.HemisphereLight(0xfff2cc, 0x886644, 0);
    ctx.scene.add(this.beam, this.glow);
    this.level = 0;
  }

  get active() { return !!this.phase; }

  start() {
    if (this.phase) return false;
    this.phase = 'ascend'; this.t = 0; this.said = false;
    for (const s of this.ctx.cultists.seats) { s.delay = 1.6 + Math.random() * 2.8; s.riseV = 0; }
    this.ctx.sfx.sting('trumpet', { gain: 0.8 });
    this.ctx.ticker('A trumpet sounds from on high…');
    this.beam.visible = true;
    return true;
  }

  update(dt) {
    if (!this.phase || !dt) return;
    const ctx = this.ctx, seats = ctx.cultists.seats;
    this.t += dt;
    if (this.phase === 'ascend') {
      let gone = 0;
      for (const s of seats) {
        if (s.gone) { gone++; continue; }
        if (this.t < s.delay) continue;
        s.riseV += dt * 2.2; s.rise += s.riseV * dt; s.spin += dt * (0.6 + (s.phase % 1));
        if (s.rise > 24) s.gone = true;
      }
      if (this.t > 1.6 && !this.said) { this.said = true; ctx.ticker('The audience is enraptured, taken up into the light'); }
      if (gone === seats.length && this.t > 7) {
        this.phase = 'grow'; this.t = 0; this.cryT = 1;
        for (const s of seats) { s.gone = false; s.rise = 0; s.spin = 0; s.age = 0; s.growRate = 1 / (GROW_SECONDS * rand(0.8, 1.25)); }
        ctx.ticker('…and every seat is filled with a baby cultist');
        ctx.sfx.sting('pop', { gain: 0.5 });
      }
    } else if (this.phase === 'grow') {
      let sum = 0;
      for (const s of seats) { s.age = Math.min(1, s.age + dt * s.growRate); sum += s.age; }
      const mean = sum / seats.length;
      // babies cry now and then; the crowd reacts less while it is so young
      this.cryT -= dt;
      if (mean < 0.4 && this.cryT <= 0) { this.cryT = rand(0.3, 1.2) * (0.4 + mean * 2); ctx.sfx.sting('cry', { gain: 0.25 + Math.random() * 0.25 }); }
      ctx.setCrowdChance(0.55 * (0.2 + 0.8 * mean));
      if (mean >= 1) { this.phase = null; ctx.setCrowdChance(0.55); ctx.ticker('The babies have grown back into their cultist selves'); }
    }
    // the light: full while they ascend, fading after
    const want = this.phase === 'ascend' ? 1 : 0;
    this.level += (want - this.level) * Math.min(1, dt * (want ? 1.5 : 0.6));
    this.beamMat.opacity = 0.35 * this.level * (0.9 + 0.1 * Math.sin(this.t * 3));
    this.glow.intensity = 2.2 * this.level;
    if (this.level < 0.01 && !want) this.beam.visible = false;
    ctx.stimAlias('raptureL', 'eyeL', 40 * this.level);
    ctx.stimAlias('raptureR', 'eyeR', 40 * this.level);
  }

  clear() {
    this.phase = null; this.level = 0; this.beam.visible = false; this.glow.intensity = 0;
    for (const s of this.ctx.cultists.seats) { s.gone = false; s.rise = 0; s.spin = 0; s.age = 1; }
    this.ctx.setCrowdChance(0.55);
    this.ctx.stimAlias('raptureL', 'eyeL', 0); this.ctx.stimAlias('raptureR', 'eyeR', 0);
  }
}

// ------------------------------------------------------------------------------------------------ rain cloud
export class RainCloud {
  constructor(ctx) { this.ctx = ctx; this.active = null; }

  start() {
    if (this.active) return false;
    const ctx = this.ctx, g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a5f68, roughness: 1, transparent: true, opacity: 0.95, flatShading: true });
    for (let k = 0; k < 11; k++) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(rand(0.5, 0.9), 1), mat);
      m.position.set(rand(-1.3, 1.3), rand(-0.2, 0.35), rand(-0.9, 0.9)); m.scale.y = 0.7; g.add(m);
    }
    const N = 240;
    const drops = new THREE.InstancedMesh(new THREE.BoxGeometry(0.012, 0.38, 0.012), new THREE.MeshBasicMaterial({ color: 0xa9c8e8, transparent: true, opacity: 0.55 }), N);
    drops.frustumCulled = false;
    const flash = new THREE.PointLight(0xdde8ff, 0, 18, 1.5);
    g.add(flash);
    const head = ctx.hostHead();
    g.position.copy(head).add(V(3, 6, 0)); g.scale.setScalar(0.1);
    ctx.scene.add(g, drops);
    const d = Array.from({ length: N }, () => ({ x: rand(-1.4, 1.4), z: rand(-1.1, 1.1), y: rand(0, 1) }));
    this.active = { g, mat, drops, d, flash, t: 0, life: rand(35, 50), level: 0, boltT: rand(3, 6), wetT: 0, sadT: 1, ground: head.y - 2.2, groundT: 0, rain: ctx.sfx.rain(), bolt: null };
    ctx.ticker('A small rain cloud gathers over Leno');
    return true;
  }

  clear() {
    const A = this.active; if (!A) return;
    A.rain.stop(); this.ctx.scene.remove(A.g, A.drops); if (A.bolt) this.ctx.scene.remove(A.bolt);
    this.active = null;
    this.ctx.stimAlias('boltL', 'eyeL', 0); this.ctx.stimAlias('boltR', 'eyeR', 0);
  }

  update(dt) {
    const A = this.active; if (!A || !dt) return;
    const ctx = this.ctx;
    A.t += dt;
    const head = ctx.hostHead();
    const leaving = A.t > A.life;
    A.level += ((leaving ? 0 : 1) - A.level) * Math.min(1, dt * (leaving ? 0.8 : 1.2));
    if (leaving && A.level < 0.02) { this.clear(); ctx.ticker('The rain cloud drifts away'); return; }
    // follow him (he can outrun it for a moment)
    const want = head.clone().add(V(0, 4.2, 0));
    A.g.position.lerp(want, Math.min(1, dt * 1.3));
    A.g.scale.setScalar(0.1 + 0.9 * A.level);
    A.mat.opacity = 0.95 * A.level;
    A.rain.set(A.level);
    A.groundT -= dt;
    if (A.groundT <= 0) { A.groundT = 0.25; const gy = ctx.groundAt(A.g.position); if (gy !== null) A.ground = gy; }
    // the rain
    const top = A.g.position.y - 0.4, m = new THREE.Matrix4(), c = A.g.position;
    A.d.forEach((p, i) => {
      p.y -= dt * 9 / Math.max(1, top - A.ground);
      if (p.y < 0) { p.y += 1; p.x = rand(-1.4, 1.4); p.z = rand(-1.1, 1.1); }
      const y = A.ground + p.y * (top - A.ground);
      m.makeTranslation(c.x + p.x * A.level, y, c.z + p.z * A.level);
      A.drops.setMatrixAt(i, A.level > 0.2 ? m : m.makeScale(0, 0, 0));
    });
    A.drops.instanceMatrix.needsUpdate = true;
    // under it: wet (touch, water on the antennae) and miserable (punishment dopamine)
    const under = Math.hypot(head.x - c.x, head.z - c.z) < 1.6 && A.level > 0.5;
    if (under) {
      A.wetT -= dt;
      if (A.wetT <= 0) { A.wetT = 0.5; ctx.pulse('rainTouch', 'ambientTouch', 35, 0.5); ctx.pulse('rainAnt', 'applause', 60, 0.4); }
      A.sadT -= dt;
      if (A.sadT <= 0) { A.sadT = 2; ctx.reinforce(-0.35, 1.5); }
    }
    // lightning and thunder
    A.boltT -= dt;
    if (A.boltT <= 0 && A.level > 0.7 && !leaving) {
      A.boltT = rand(5, 10);
      A.flashT = 0.18;
      const pts = [c.clone().add(V(0, -0.3, 0))];
      for (let k = 1; k < 7; k++) pts.push(c.clone().lerp(head, k / 7).add(V(rand(-0.3, 0.3), 0, rand(-0.3, 0.3))));
      pts.push(head.clone().add(V(0, 0.3, 0)));
      if (A.bolt) ctx.scene.remove(A.bolt);
      A.bolt = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xeef4ff, toneMapped: false }));
      A.bolt.frustumCulled = false; ctx.scene.add(A.bolt);
      setTimeout(() => ctx.sfx.sting('thunder', { gain: 0.9 }), 250);
      if (under) ctx.pulse('boltTouch', 'ambientTouch', 60, 0.25);
    }
    if (A.flashT > 0) {
      A.flashT -= dt;
      A.flash.intensity = A.flashT > 0 ? 400 : 0;
      if (A.flashT <= 0 && A.bolt) { ctx.scene.remove(A.bolt); A.bolt = null; }
    }
    const eye = A.flashT > 0 ? 80 : 0;
    ctx.stimAlias('boltL', 'eyeL', eye); ctx.stimAlias('boltR', 'eyeR', eye);
  }
}

// ------------------------------------------------------------------------------------------------ mushroom
function mushroomModel() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, flatShading: false });
  const RED = 0xd4221c, CREAM = 0xf3e9d2, GREEN = 0x2e9a2b, DARK = 0x111111;
  const parts = [
    col(new THREE.CylinderGeometry(0.13, 0.15, 0.22, 16).translate(0, 0.11, 0), CREAM),                         // stem
    col(new THREE.SphereGeometry(0.026, 8, 6).scale(0.6, 1.4, 0.5).translate(0.05, 0.14, 0.13), DARK),        // eyes
    col(new THREE.SphereGeometry(0.026, 8, 6).scale(0.6, 1.4, 0.5).translate(-0.05, 0.14, 0.13), DARK),
    col(new THREE.SphereGeometry(0.25, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55).scale(1, 0.85, 1).translate(0, 0.19, 0), RED),   // tomato cap
    col(new THREE.CylinderGeometry(0.245, 0.245, 0.02, 20).translate(0, 0.2, 0), 0xa3160f),                    // cap rim
  ];
  for (const [a, e] of [[0.4, 0.6], [2.3, 0.5], [4.1, 0.75], [5.5, 0.45]]) {                                   // pale spots
    const p = V(Math.cos(a) * Math.sin(e), Math.cos(e), Math.sin(a) * Math.sin(e)).multiplyScalar(0.25);
    parts.push(col(new THREE.SphereGeometry(0.055, 10, 6).scale(1, 0.35, 1).lookAt(p).translate(p.x, 0.19 + p.y * 0.85, p.z), CREAM));
  }
  for (let k = 0; k < 5; k++) {                                                                                 // leafy calyx
    const a = k / 5 * Math.PI * 2;
    parts.push(col(new THREE.ConeGeometry(0.045, 0.2, 4).rotateZ(Math.PI / 2 - 0.35).rotateY(-a).translate(Math.cos(a) * 0.08, 0.41, Math.sin(a) * 0.08), GREEN));
  }
  parts.push(col(new THREE.CylinderGeometry(0.015, 0.02, 0.1, 6).translate(0, 0.45, 0), GREEN));              // stalk
  parts.push(col(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI * 1.5).translate(0.04, 0.53, 0), GREEN));  // curly vine
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(parts), mat));
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(1.7);
  return g;
}

export class VineMushroom {
  constructor(ctx) { this.ctx = ctx; this.active = null; }

  start() {
    if (this.active) return false;
    const ctx = this.ctx, c = ctx.center, a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * ctx.stageRadius * 0.55;
    const mesh = mushroomModel();
    mesh.position.set(c.x + Math.cos(a) * r, ctx.ceilY - 1, c.z + Math.sin(a) * r);
    ctx.scene.add(mesh);
    const d = Math.random() * 6.28;
    this.active = { mesh, vy: 0, bounces: 0, state: 'fall', t: 0, dir: V(Math.cos(d), 0, Math.sin(d)), item: null, ground: c.y };
    ctx.sfx.sting('powerup', { gain: 0.45 });
    ctx.ticker('A mushroom falls from the ceiling');
    return true;
  }

  clear() {
    const A = this.active; if (!A) return;
    if (A.item && this.ctx.food.items.includes(A.item)) this.ctx.food.remove(A.item); else this.ctx.scene.remove(A.mesh);
    this.active = null;
  }

  update(dt) {
    const A = this.active; if (!A || !dt) return;
    const ctx = this.ctx, p = A.mesh.position;
    A.t += dt;
    if (A.item && !ctx.food.items.includes(A.item)) { this.active = null; return; }   // eaten
    if (A.t > 70) { this.clear(); return; }
    const gy = ctx.groundAt(p) ?? A.ground;
    A.ground = gy;
    if (A.state === 'fall') {
      A.vy -= 9.8 * dt; p.y += A.vy * dt;
      if (p.y <= gy) {
        p.y = gy;
        if (A.bounces < 1 && A.vy < -3) { A.vy = -A.vy * 0.35; A.bounces++; }
        else {
          A.state = 'slide';
          A.item = ctx.food.addMushroom(p, A.mesh);
          ctx.sfx.sting('pop', { gain: 0.3 });
        }
      }
      return;
    }
    // slides along like a power-up, turning back at the platform rim; stops when he's right there to eat it
    const host = ctx.hostPos();
    const near = Math.hypot(host.x - p.x, host.z - p.z) < 1.8;
    if (!near) {
      const next = p.clone().addScaledVector(A.dir, 0.9 * dt);
      const fromC = next.clone().sub(ctx.center).setY(0);
      if (fromC.length() > ctx.stageRadius * 0.72) A.dir.reflect(fromC.normalize()).setY(0).normalize();
      else { p.x = next.x; p.z = next.z; }
    }
    p.y += (gy - p.y) * Math.min(1, dt * 10);
    A.mesh.rotation.y += dt * 0.6;
    A.item?.pos.copy(p);
  }
}

// ------------------------------------------------------------------------------------------------ mini aliens
const AL = 0.95;                           // height (m)

function alienParts() {
  const GREY = 0x9aa3a8, DARK = 0x0a0a0c;
  const upper = mergeGeometries([
    col(new THREE.SphereGeometry(0.16, 14, 10).scale(1, 1.2, 0.95).translate(0, 0.74, 0), GREY),                  // big head
    col(new THREE.SphereGeometry(0.055, 10, 6).scale(1.5, 0.7, 0.45).rotateZ(-0.45).translate(0.065, 0.75, 0.125), DARK),
    col(new THREE.SphereGeometry(0.055, 10, 6).scale(1.5, 0.7, 0.45).rotateZ(0.45).translate(-0.065, 0.75, 0.125), DARK),
    col(new THREE.CylinderGeometry(0.018, 0.03, 0.09, 6).translate(0, 0.57, 0), GREY),                             // neck
    col(new THREE.CapsuleGeometry(0.075, 0.2, 4, 8).translate(0, 0.43, 0), GREY),                                   // torso
    col(new THREE.CylinderGeometry(0.018, 0.015, 0.3, 5).rotateZ(0.35).translate(0.12, 0.4, 0), GREY),             // arms
    col(new THREE.CylinderGeometry(0.018, 0.015, 0.3, 5).rotateZ(-0.35).translate(-0.12, 0.4, 0), GREY),
  ]);
  const leg = mergeGeometries([
    col(new THREE.CylinderGeometry(0.025, 0.02, 0.3, 6).translate(0, -0.15, 0), GREY),
    col(new THREE.BoxGeometry(0.06, 0.03, 0.1).translate(0, -0.3, 0.03), GREY),                                     // foot
  ]);
  return { upper, leg };
}

export class MiniAliens {
  constructor(ctx) {
    this.ctx = ctx; this.list = []; this.active = false;
    const { upper, leg } = alienParts(), mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.1 });
    const MAX = 48;
    this.meshes = [upper, leg, leg].map((g) => {
      const m = new THREE.InstancedMesh(g, mat, MAX); m.count = 0; m.frustumCulled = false; m.castShadow = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); ctx.scene.add(m); return m;
    });
    this.ray = new THREE.Raycaster();
  }

  start(n = 24 + ((Math.random() * 16) | 0)) {
    if (this.active) return false;
    const ctx = this.ctx, c = ctx.center;
    this.list = Array.from({ length: n }, (_, i) => {
      const a = Math.random() * 6.28, r = ctx.stageRadius * rand(1.05, 1.5);
      const p = V(c.x + Math.cos(a) * r, c.y, c.z + Math.sin(a) * r);
      p.y = ctx.groundAt(p) ?? c.y;
      return { p, home: p.clone(), yaw: 0, state: 'approach', ang: (i / n) * Math.PI * 2 + rand(-0.2, 0.2), rad: rand(0.65, 1.0),
        speed: rand(1.6, 2.6), walk: Math.random() * 6, kick: 0, side: 1, cool: rand(0, 1.5), gT: 0, hit: false };
    });
    this.active = true; this.leaving = false; this.t = 0; this.life = rand(28, 38); this.chatT = 0.3; this.hits = 0;
    ctx.ticker(`${n} little grey aliens march onto the stage`);
    return true;
  }

  clear() { this.list = []; this.active = false; for (const m of this.meshes) m.count = 0; }

  groundAt(a) {
    a.gT -= 1;
    if (a.gT > 0) return;
    a.gT = 5;
    const gy = this.ctx.groundAt(a.p);
    if (gy !== null) a.gy = gy;
  }

  update(dt) {
    if (!this.active || !dt) return;
    const ctx = this.ctx;
    this.t += dt;
    const host = ctx.hostPos(), shins = ctx.shins();
    if (this.t > this.life && !this.leaving) { this.leaving = true; for (const a of this.list) a.state = 'leave'; ctx.ticker('The little aliens scatter'); }
    // chatter: "TOES" / "mimimi" from somewhere in the crowd of them
    this.chatT -= dt;
    if (this.chatT <= 0 && this.list.length) {
      this.chatT = rand(0.35, 1.1);
      const a = this.list[(Math.random() * this.list.length) | 0];
      ctx.playSfx(Math.random() < 0.5 ? 'sfx/minialien/TOES.mp3' : 'sfx/minialien/mimimi.mp3', { gain: rand(0.45, 0.8), pan: ctx.pan(a.p), rate: rand(0.95, 1.12) });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = V(1, 1, 1);
    let n = 0;
    for (const a of this.list) {
      this.groundAt(a);
      let moving = false;
      if (a.state === 'approach' || a.state === 'leave') {
        const target = a.state === 'leave' ? a.home : host.clone().add(V(Math.cos(a.ang) * a.rad, 0, Math.sin(a.ang) * a.rad));
        const d = target.clone().sub(a.p).setY(0), dist = d.length();
        if (a.state === 'leave' && dist < 0.4) { a.done = true; continue; }
        if (a.state === 'approach' && dist < 0.25) {
          a.cool -= dt;
          const to = host.clone().sub(a.p); a.yaw = Math.atan2(to.x, to.z);
          if (a.cool <= 0) { a.state = 'kick'; a.kick = 0; a.hit = false; a.side = Math.random() < 0.5 ? 1 : -1; }
        } else {
          a.p.addScaledVector(d.normalize(), Math.min(dist, a.speed * (a.state === 'leave' ? 1.4 : 1) * dt));
          a.yaw = Math.atan2(d.x, d.z); moving = true;
        }
      } else if (a.state === 'kick') {
        a.kick += dt;
        const to = host.clone().sub(a.p); a.yaw = Math.atan2(to.x, to.z);
        if (!a.hit && a.kick > 0.2) {
          a.hit = true;
          // the kicking foot, against the nearest shin
          const foot = a.p.clone().add(V(Math.sin(a.yaw) * 0.35, 0.25, Math.cos(a.yaw) * 0.35));
          const shin = shins.reduce((b, s) => (s.distanceTo(foot) < b.distanceTo(foot) ? s : b), shins[0]);
          if (shin && shin.distanceTo(foot) < 0.8) {
            this.hits++;
            ctx.kick(shins.indexOf(shin), V(Math.sin(a.yaw), 0.25, Math.cos(a.yaw)));
            ctx.playSfx('sfx/minialien/go_alert2.wav', { gain: 0.55, pan: ctx.pan(a.p) });
          }
        }
        if (a.kick > 0.45) {
          a.state = this.leaving ? 'leave' : 'approach'; a.cool = rand(1.4, 3.4);
          a.ang += rand(-0.7, 0.7); a.rad = rand(0.6, 1.0);                     // shuffle around him
        }
      }
      a.p.y += ((a.gy ?? a.p.y) - a.p.y) * Math.min(1, dt * 12);
      // pose: walk cycle, or a kick (wind up back, swing forward)
      a.walk += dt * (moving ? 14 : 2);
      const sw = moving ? Math.sin(a.walk) * 0.6 : 0;
      let legA = sw, legB = -sw;
      if (a.state === 'kick') { const u = a.kick / 0.45; const k = u < 0.4 ? -0.8 * (u / 0.4) : -0.8 + 2.4 * Math.sin(Math.min(1, (u - 0.4) / 0.35) * Math.PI / 2); if (a.side > 0) legA = k; else legB = k; }
      const bob = moving ? Math.abs(Math.sin(a.walk)) * 0.03 : 0;
      q.setFromEuler(e.set(0, a.yaw, moving ? Math.sin(a.walk) * 0.08 : 0));
      const root = new THREE.Matrix4().compose(a.p.clone().add(V(0, bob, 0)), q, one);
      this.meshes[0].setMatrixAt(n, root);
      for (const [k, s, ang] of [[1, 1, legA], [2, -1, legB]]) {
        m.compose(V(0.05 * s, 0.32, 0), new THREE.Quaternion().setFromEuler(e.set(ang, 0, 0)), one);
        this.meshes[k].setMatrixAt(n, root.clone().multiply(m));
      }
      n++;
    }
    this.list = this.list.filter((a) => !a.done);
    for (const mesh of this.meshes) { mesh.count = n; mesh.instanceMatrix.needsUpdate = true; }
    if (!this.list.length) { this.active = false; this.leaving = false; }
  }
}

// ------------------------------------------------------------------------------------------------ scheduler
export class Happenings {
  /**
   * ctx: { scene, sfx, cultists, food, center, stageRadius, ceilY, groundAt(p), hostPos(), hostHead(), shins(),
   *        kick(i, dir), dropRig(kind, p), playSfx(file, opts), pan(p), setCrowdChance(x), stimAlias, pulse,
   *        reinforce, ticker }
   */
  constructor(ctx) {
    this.ctx = ctx;
    this.rapture = new Rapture(ctx);
    this.rain = new RainCloud(ctx);
    this.mushroom = new VineMushroom(ctx);
    this.aliens = new MiniAliens(ctx);
    this.enabled = true;
    this.timers = { rapture: rand(420, 900), rain: rand(150, 330), mushroom: rand(90, 220), rig: rand(100, 280), aliens: rand(200, 420) };
  }

  /** a camera or light (or two, or three) breaks loose from the rig */
  rigFall(n = 1 + ((Math.random() * 3) | 0)) {
    const ctx = this.ctx;
    ctx.ticker(n > 1 ? 'The lighting rig groans… things are falling!' : 'Something breaks loose from the rig above');
    ctx.sfx.sting('creak', { gain: 0.8 });
    for (let k = 0; k < n; k++) {
      setTimeout(() => {
        const h = ctx.hostHead(), off = Math.random() < 0.5 ? 0.3 : rand(0.8, 2.6), a = Math.random() * 6.28;
        ctx.dropRig(Math.random() < 0.5 ? 'camera' : 'light', V(h.x + Math.cos(a) * off, ctx.ceilY - 0.6, h.z + Math.sin(a) * off));
      }, 500 + k * rand(300, 900));
    }
  }

  update(dt, on) {
    if (!dt) return;
    const T = this.timers;
    if (this.enabled && on) {
      for (const k in T) T[k] -= dt;
      const big = this.rapture.active || this.rain.active || this.aliens.active;
      if (T.rapture <= 0) { T.rapture = rand(600, 1200); if (!big) this.rapture.start(); }
      else if (T.rain <= 0) { T.rain = rand(180, 400); if (!big) this.rain.start(); }
      else if (T.aliens <= 0) { T.aliens = rand(240, 480); if (!big) this.aliens.start(); }
      if (T.mushroom <= 0) { T.mushroom = rand(120, 300); this.mushroom.start(); }
      if (T.rig <= 0) { T.rig = rand(120, 320); this.rigFall(); }
    }
    this.rapture.update(dt); this.rain.update(dt); this.mushroom.update(dt); this.aliens.update(dt);
  }

  clear() { this.rapture.clear(); this.rain.clear(); this.mushroom.clear(); this.aliens.clear(); }
}
