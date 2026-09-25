// Kybo Rin (a guest segment, like the Jonkler): a Kylo Ren-style robed figure with a Commodore PET for a head. He
// storms on, ignites a crossguard lightsaber and rampages about the stage for as long as his rant (kylorant.mp3)
// plays: wandering, flailing both arms, chopping and sweeping the saber. The blade is ray cast against the physics
// world every frame: striking the floor or the set throws sparks and plays a saber smack or clash, and if it catches
// Leno he is sent flying. Then the saber goes off and he stalks away.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { colored, limb, FIGURE_SCALE, NECK } from './cultist-model.js';
import { keep } from './dispose.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const S = FIGURE_SCALE;
const ROBE = 0x0d0b0a, TUNIC = 0x110f0e, CAPE = 0x080707, BELT = 0x2a2522, GLOVE = 0x060505, CASE = 0xe4dcc6,   // (black cloth: it's often in a follow spot)
  TRIM = 0x2a2c34, BEZEL = 0x17181c;
const BLADE = 1.0;                                     // blade length (figure units)
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = Math.max(0, Math.min(1, u)); return u * u * (3 - 2 * u); };
let mat = null, keyTex = null, screenMat = null, keyMat = null;

/** the PET's keyboard slope: the Commodore badge, the built-in cassette deck and the chiclet keyboard */
function keyboardTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = '#e4dcc6'; x.fillRect(0, 0, 512, 192);
  x.fillStyle = '#23252c'; x.strokeStyle = '#23252c'; x.textBaseline = 'middle';
  x.lineWidth = 5; x.beginPath(); x.arc(24, 22, 9, 0.7, Math.PI * 2 - 0.7); x.stroke();
  x.font = 'bold 22px Arial, sans-serif'; x.fillText('commodore', 42, 22);
  x.font = 'bold 26px "Arial Black", Arial, sans-serif'; x.fillText('PET', 318, 22);
  x.font = '13px Arial, sans-serif'; x.fillText('2001 SERIES', 384, 23);
  x.fillStyle = '#2b2d33'; x.fillRect(16, 44, 150, 132);
  x.fillStyle = '#6d7078'; x.fillRect(30, 56, 122, 58);
  x.fillStyle = '#e4dcc6'; for (let k = 0; k < 6; k++) x.fillRect(24 + k * 23, 132, 18, 34);
  x.fillStyle = '#2b2d33'; x.fillRect(184, 44, 312, 132);
  for (let r = 0; r < 5; r++) for (let k = 0; k < 14; k++) {
    x.fillStyle = k >= 11 ? '#b9b3a3' : '#d8d1bf';
    x.fillRect(192 + k * 21.5, 52 + r * 24.5, 17, 19);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** the PET's screen, glowing red (a soft gradient and faint scanlines) */
function screenTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 96;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 44, 6, 64, 48, 80);
  g.addColorStop(0, '#ff3b2e'); g.addColorStop(0.7, '#e0120c'); g.addColorStop(1, '#8c0806');
  x.fillStyle = g; x.fillRect(0, 0, 128, 96);
  x.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < 96; y += 3) x.fillRect(0, y, 128, 1);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** a saber blade `len` long along +y from the origin: a white-hot core in a red glow */
function bladeMeshes(len, r) {
  const core = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.3, r * 0.3, len, 8, 1).translate(0, len / 2, 0),
    new THREE.MeshBasicMaterial({ color: 0xffe2dc, toneMapped: false }));
  const glow = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, len, 10, 1, true).translate(0, len / 2, 0),
    new THREE.MeshBasicMaterial({ color: 0xff1c0e, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const haze = new THREE.Mesh(new THREE.CylinderGeometry(r * 2, r * 1.7, len * 1.02, 10, 1, true).translate(0, len / 2, 0),
    new THREE.MeshBasicMaterial({ color: 0xff2410, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  return [core, glow, haze];
}

/** Kybo Rin, on the stagehands' rig (skirt, body, head, armL, armR) plus .saber, .blade and .guard on the right hand */
export function kyboFigure() {
  mat ||= keep(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, side: THREE.DoubleSide }));
  keyTex ||= keep(keyboardTexture());
  keyMat ||= keep(new THREE.MeshStandardMaterial({ map: keyTex, roughness: 0.6 }));
  screenMat ||= keep(new THREE.MeshBasicMaterial({ map: keep(screenTexture()), toneMapped: false }));
  const mk = (geo, m = mat) => { const o = new THREE.Mesh(geo.scale(S, S, S), m); o.castShadow = true; return o; };
  const g = new THREE.Group();
  // the long robe, to the floor (origin at the waist)
  g.skirt = mk(colored(new THREE.CylinderGeometry(0.21, 0.37, 0.72, 14, 1).translate(0, -0.36, 0), ROBE));
  // tunic, wide belt, a short mantle over the shoulders, the hood down around the neck, and a long cape behind
  g.body = mk(mergeGeometries([
    colored(new THREE.CylinderGeometry(0.21, 0.23, 0.62, 12, 1).translate(0, 0.31, 0), TUNIC),
    colored(new THREE.CylinderGeometry(0.235, 0.235, 0.09, 14, 1).translate(0, 0.05, 0), BELT),
    colored(new THREE.BoxGeometry(0.1, 0.07, 0.02).translate(0, 0.05, 0.235), 0x5a524c),
    colored(new THREE.CylinderGeometry(0.17, 0.3, 0.26, 14, 1, true).translate(0, 0.54, 0), CAPE),
    colored(new THREE.TorusGeometry(0.15, 0.06, 6, 14).rotateX(Math.PI / 2).translate(0, 0.68, -0.02), CAPE),
    colored(new THREE.CylinderGeometry(0.26, 0.42, 1.3, 14, 1, true, Math.PI / 2, Math.PI).translate(0, -0.03, -0.02), CAPE),
  ]));
  // the head: a Commodore PET (base with the keyboard slope, the monitor hood set back, a red screen in a dark bezel)
  g.head = new THREE.Group();
  const slope = 0.35;
  g.head.add(mk(mergeGeometries([
    colored(new THREE.BoxGeometry(0.66, 0.12, 0.5).translate(0, 0.08, 0.02), CASE),
    colored(new THREE.BoxGeometry(0.67, 0.035, 0.51).translate(0, 0.035, 0.02), TRIM),
    colored(new THREE.BoxGeometry(0.66, 0.06, 0.26).rotateX(slope).translate(0, 0.16, 0.12), CASE),
    colored(new THREE.BoxGeometry(0.5, 0.34, 0.34).translate(0, 0.33, -0.1), CASE),
    colored(new THREE.BoxGeometry(0.42, 0.28, 0.02).translate(0, 0.34, 0.075), BEZEL),
  ])));
  g.head.add(mk(new THREE.PlaneGeometry(0.62, 0.24).rotateX(-(Math.PI / 2 - slope)).translate(0, 0.198, 0.134), keyMat));   // (clear of the slope's top)
  g.head.add(mk(new THREE.PlaneGeometry(0.34, 0.23).translate(0, 0.345, 0.087), screenMat));
  g.head.position.copy(NECK).multiplyScalar(S);
  const arm = (side) => mk(mergeGeometries([
    limb(V(0, 0, 0), V(0.03 * side, -0.5, 0.04), 0.075, 0.065, TUNIC, 7),
    colored(new THREE.CylinderGeometry(0.068, 0.072, 0.1, 8, 1).translate(0.03 * side, -0.44, 0.04), GLOVE),
    colored(new THREE.SphereGeometry(0.065, 8, 6).scale(1, 1.15, 1.2).translate(0.03 * side, -0.56, 0.05), GLOVE),
  ]));
  g.armL = arm(1); g.armL.position.set(0.25 * S, 0.6 * S, 0);
  g.armR = arm(-1); g.armR.position.set(-0.25 * S, 0.6 * S, 0);
  g.skirt.position.y = 0.72 * S; g.body.position.y = 0.72 * S;
  g.body.add(g.head, g.armL, g.armR);
  g.add(g.skirt, g.body);
  // the crossguard lightsaber in his right fist: +y of the saber is the blade. Its tilt in the hand (saber.rotation.x
  // = PI + w) is the wrist: w = 0 continues the arm, w = -1.2 points it forward
  const saber = new THREE.Group(); saber.position.copy(V(-0.03, -0.57, 0.05).multiplyScalar(S));
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b30, metalness: 0.7, roughness: 0.35 });
  saber.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.025, 0.26, 10).translate(0, -0.03, 0).scale(S, S, S), metal));
  saber.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.09, 8).rotateZ(Math.PI / 2).translate(0, 0.07, 0).scale(S, S, S), metal));
  const blade = new THREE.Group(); blade.position.y = 0.11 * S; blade.add(...bladeMeshes(BLADE * S, 0.035 * S));
  const guard = new THREE.Group(); guard.position.y = 0.07 * S;
  for (const s of [-1, 1]) {
    const q = new THREE.Group(); q.rotation.z = -s * Math.PI / 2; q.position.x = 0.04 * S * s;
    q.add(...bladeMeshes(0.13 * S, 0.028 * S)); guard.add(q);
  }
  saber.add(blade, guard); saber.rotation.x = Math.PI - 1.2;
  blade.scale.y = 0.001; guard.scale.setScalar(0.001); blade.visible = guard.visible = false;
  g.armR.add(saber);
  g.saber = saber; g.blade = blade; g.guard = guard;
  return g;
}

export class KyboRin {
  /** ctx: { npcs, scene, audio, center, stageRadius, getLeno() -> { pos }, pan(p) -> -1..1, ticker(text),
   *        bladeHit(from, dir, len, npc) -> { kind: 'leno' | 'floor' | 'prop', p } | null,
   *        onHitLeno(dir, p) (the saber caught him), sparks(p, n) } */
  constructor(ctx) {
    this.ctx = ctx; this.npc = null; this.ext = 0; this.want = 0;
    // the blade's red light on the set (always in the scene, dark while he's away: adding and removing a light
    // would recompile every material)
    this.light = new THREE.PointLight(0xff2414, 0, 6, 2); ctx.scene.add(this.light);
  }

  get present() { return !!this.npc && !this.npc.done; }
  headPos() { return this.present ? this.fig.position.clone().add(V(0, 2.3, 0)) : null; }

  /** storm on, ignite the saber, rampage for as long as the rant plays, douse it, stalk off */
  enter() {
    if (this.present) return false;
    const ctx = this.ctx, c = ctx.center, side = Math.random() < 0.5 ? -1 : 1;
    const wing = c.clone().add(V(side * 11, 0, -3));
    const leno = ctx.getLeno().pos, lim = ctx.stageRadius * 0.72;
    const spot = leno.clone().addScaledVector(wing.clone().sub(leno).setY(0).normalize(), 3.5);
    const fromC = spot.clone().sub(c).setY(0);
    if (fromC.length() > lim) spot.copy(c).addScaledVector(fromC.setLength(lim), 1);
    const fig = this.fig = kyboFigure();
    Object.assign(this, { ext: 0, want: 0, clock: 0, rt: 0, target: null, strike: null, pose: null, prevTip: null, swingCool: 0,
      lastHit: { kind: null, t: -9 }, lenoHitAt: -9, rantDone: false });
    const rant = ctx.audio.clips?.('music', 'kylorant')?.[0];
    this.rantLen = rant?.dur ?? 60;
    if (rant && ctx.audio.ctx) ctx.audio.load(rant.file);             // (1 MB: fetched while he walks on)
    const rampage = { type: 'pose', dur: this.rantLen + 3, pose: (f, t) => { this.rampage(f, t); if (this.rantDone) rampage.dur = 0; } };
    this.npc = ctx.npcs.scripted(fig, wing, (n) => [
      { type: 'walk', to: spot, within: 0.4, speed: 1.8 },
      { type: 'pose', dur: 0.01, then: () => this.ignite() },
      { type: 'pose', dur: 1.2, pose: (f, t) => this.brandish(f, Math.min(1, t / 0.35)) },
      rampage,
      { type: 'pose', dur: 0.01, then: () => this.douse() },
      { type: 'pose', dur: 0.8, pose: (f, t) => this.brandish(f, 1 - t / 0.8) },
      { type: 'walk', to: wing, within: 0.5, speed: 1.8 },
      { type: 'pose', dur: 0.05, then: () => { this.stopSounds(); n.remove(); } },
    ]);
    ctx.ticker?.('Kybo Rin storms onto the stage');
    return true;
  }

  /** the saber held up in front of him (k: 0 arm down .. 1 raised) */
  brandish(f, k) {
    f.armR.rotation.set(-2.1 * k, 0, -0.3 * k); f.saber.rotation.x = Math.PI - 1.2 + 0.9 * k;
    f.armL.rotation.set(-0.6 * k, 0, 0.4 * k);
    const d = this.ctx.getLeno().pos.clone().sub(f.position);
    let dy = Math.atan2(d.x, d.z) - f.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); f.rotation.y += dy * 0.1;
  }

  ignite() {
    const ctx = this.ctx; this.want = 1;
    ctx.audio.sfx?.('saberon', { gain: 0.9, pan: ctx.pan(this.fig.position) });
    this.startHum(); this.startRant();
    ctx.ticker?.('Kybo Rin ignites his lightsaber');
  }

  douse() {
    const ctx = this.ctx; this.want = 0;
    ctx.audio.sfx?.('saberoff', { gain: 0.9, pan: ctx.pan(this.fig.position) });
    this.stopSounds();
  }

  /** the rampage: a lurching walk about the stage (often toward Leno) with pauses to thrash in place; the saber arm
   *  strikes pose to pose (overhead, a chop at the floor, a sweep across), the other arm flails, the PET shakes */
  rampage(f, t) {
    const ctx = this.ctx, dt = Math.min(0.1, Math.max(0, t - this.rt)); this.rt = t;
    const pos = f.position;
    if (!this.target || pos.distanceTo(this.target) < 0.5 || t > this.targetUntil) {
      const c = ctx.center, lim = ctx.stageRadius * 0.75;
      const p = Math.random() < 0.35 ? ctx.getLeno().pos.clone().add(V(rand(-1.3, 1.3), 0, rand(-1.3, 1.3)))
        : c.clone().add(V(rand(-1, 1) * lim, 0, rand(-1, 1) * lim));
      const off = p.clone().sub(c).setY(0); if (off.length() > lim) p.copy(c).add(off.setLength(lim));
      this.target = p; this.targetUntil = t + rand(3, 7); this.pauseUntil = Math.random() < 0.3 ? t + rand(0.8, 2) : t;
    }
    let moving = false;
    if (t > this.pauseUntil) {
      const d = this.target.clone().sub(pos).setY(0);
      if (d.length() > 0.3) {
        let dy = Math.atan2(d.x, d.z) - f.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        f.rotation.y += dy * Math.min(1, dt * 4);
        const v = 1.3 * (0.55 + 0.45 * Math.abs(Math.sin(t * 3.1)));
        pos.x += Math.sin(f.rotation.y) * v * dt; pos.z += Math.cos(f.rotation.y) * v * dt;
        moving = true;
      }
    }
    const gy = ctx.npcs.groundAt(pos); if (gy !== null) pos.y += (gy - pos.y) * Math.min(1, dt * 12);
    this.phase = (this.phase ?? 0) + dt * (moving ? 7 : 2);
    f.body.position.y = 0.72 * S + Math.abs(Math.sin(this.phase)) * 0.05;
    if (!this.strike || t > this.strike.t0 + this.strike.dur + this.strike.rest) this.strike = this.nextStrike(t);
    const k = this.strike, u = smooth((t - k.t0) / k.dur), p = (key) => lerp(k.from[key], k.to[key], u);
    f.armR.rotation.set(p('rx'), 0, p('rz'));
    f.saber.rotation.x = Math.PI + p('w');
    f.body.rotation.set(p('lean'), p('twist'), 0);
    f.armL.rotation.set(-1.2 + 1.1 * Math.sin(t * 6.3) + 0.4 * Math.sin(t * 13.1), 0, 0.5 + 0.5 * Math.sin(t * 4.7 + 1));
    f.head.rotation.set(0.12 * Math.sin(t * 9), 0.25 * Math.sin(t * 3.3), 0.1 * Math.sin(t * 11));
  }

  nextStrike(t) {
    const from = this.pose ?? { rx: -2.1, rz: -0.3, w: -0.3, lean: 0, twist: 0 }, r = Math.random();
    const to = r < 0.3 ? { rx: rand(-2.9, -2.4), rz: rand(-0.5, 0.2), w: rand(-0.4, 0), lean: -0.15, twist: rand(-0.3, 0.3) }   // raised overhead
      : r < 0.55 ? { rx: rand(-0.75, -0.35), rz: rand(-0.3, 0.3), w: rand(-0.2, 0.05), lean: 0.35, twist: rand(-0.2, 0.2) }       // a chop at the floor
        : { rx: rand(-1.7, -1.1), rz: rand(-1.3, 0.5), w: rand(-1.0, -0.2), lean: 0.1, twist: rand(-0.6, 0.6) };                // a sweep across
    this.pose = to;
    return { t0: t, dur: rand(0.16, 0.38), rest: rand(0.05, 0.5), from, to };
  }

  update(dt) {
    if (!this.npc) return;
    if (this.npc.done) { this.leave(); return; }
    const ctx = this.ctx, f = this.fig;
    this.clock += dt;
    // ignition: the blade shoots out (and back in), with a faint crackle in its width
    this.ext += Math.sign(this.want - this.ext) * Math.min(Math.abs(this.want - this.ext), dt / 0.22);
    const on = this.ext > 0.01, w = 1 + 0.08 * Math.sin(this.clock * 53) * Math.sin(this.clock * 7);
    f.blade.visible = f.guard.visible = on;
    f.blade.scale.set(w, Math.max(0.001, this.ext), w); f.guard.scale.setScalar(Math.max(0.001, this.ext));
    f.updateMatrixWorld(true);
    const base = V(0, 0.11 * S, 0).applyMatrix4(f.saber.matrixWorld);
    const dir = V(0, 1, 0).transformDirection(f.saber.matrixWorld);
    const len = BLADE * S * this.ext, tip = base.clone().addScaledVector(dir, len);
    this.light.position.copy(base).addScaledVector(dir, len * 0.7);
    this.light.intensity = on ? 2.5 * this.ext : 0;
    // hum (pitch and level follow the blade's speed), swing whooshes, and the rant, all panned with him
    const pan = ctx.pan(f.position);
    const speed = this.prevTip && on ? tip.distanceTo(this.prevTip) / Math.max(dt, 1e-3) : 0;
    this.prevTip = tip;
    if (this.hum) {
      this.hum.src.playbackRate.value = 1 + Math.min(0.3, speed / 30);
      this.hum.g.gain.value = (0.25 + Math.min(0.25, speed / 40)) * this.ext; this.hum.p.pan.value = pan;
    }
    if (this.rant) this.rant.p.pan.value = pan * 0.4;                // (never all in one ear)
    this.swingCool -= dt;
    if (this.ext > 0.9 && speed > 5 && this.swingCool <= 0) {
      this.swingCool = rand(0.3, 0.5);
      ctx.audio.sfx?.('saberswing', { pan, gain: 0.3 + Math.min(0.3, speed / 40) });
    }
    // the blade against the world: the floor, the set, Leno
    if (this.ext < 0.9) return;
    const hit = ctx.bladeHit(base, dir, len, this.npc);
    if (!hit) { this.lastHit.kind = null; return; }
    if (hit.kind === this.lastHit.kind && this.clock - this.lastHit.t < 0.45) return;
    this.lastHit = { kind: hit.kind, t: this.clock };
    const hp = ctx.pan(hit.p);
    if (hit.kind === 'prop') ctx.audio.sfx?.('saberclash', { pan: hp, gain: 0.8 });
    else ctx.audio.sfx?.('saberhit', { pan: hp, gain: 0.85 });
    ctx.sparks?.(hit.p, hit.kind === 'leno' ? 16 : 30);
    if (hit.kind === 'leno' && this.clock - this.lenoHitAt > 1.2) {
      this.lenoHitAt = this.clock;
      ctx.audio.sfx?.('saberfield', { pan: hp, gain: 0.7 });
      ctx.onHitLeno?.(hit.p.clone().sub(f.position).setY(0), hit.p);
    }
  }

  // ---------------------------------------------------------------- sound
  async startHum() {
    const A = this.ctx.audio, clip = A.clips?.('sfx', 'saberhum')?.[0];
    if (!clip || !A.ctx) return;
    const buf = await A.load(clip.file);
    if (!buf || !this.present || this.want === 0 || this.hum) return;
    this.hum = this.voice(buf, 0, true);
  }

  async startRant() {
    const A = this.ctx.audio, clip = A.clips?.('music', 'kylorant')?.[0];
    if (!clip || !A.ctx) return;
    const buf = await A.load(clip.file);
    if (!buf || !this.present || this.want === 0 || this.rant) return;
    const v = this.rant = this.voice(buf, 1, false, true);
    v.src.onended = () => { if (this.rant === v) this.rantDone = true; };
  }

  /** a sound he carries about: buffer -> gain -> panner -> the in-world bus. loud: compressed, made up and limited
   *  first (the rant: about 9 dB louder, peaks held under 0 dB, so it carries over the saber) */
  voice(buf, gain, loop, loud = false) {
    const A = this.ctx.audio, ctx = A.ctx;
    const src = ctx.createBufferSource(), g = ctx.createGain(), p = ctx.createStereoPanner();
    src.buffer = buf; src.loop = loop; g.gain.value = gain;
    let head = src;
    if (loud) {
      const comp = ctx.createDynamicsCompressor(), makeup = ctx.createGain(), lim = ctx.createDynamicsCompressor();
      Object.entries({ threshold: -28, knee: 6, ratio: 6, attack: 0.003, release: 0.25 }).forEach(([k, v]) => (comp[k].value = v));
      Object.entries({ threshold: -6, knee: 0, ratio: 20, attack: 0, release: 0.08 }).forEach(([k, v]) => (lim[k].value = v));
      makeup.gain.value = 2;
      head = src.connect(comp).connect(makeup).connect(lim);
    }
    head.connect(g).connect(p).connect(A.bus); src.start();
    return { src, g, p };
  }

  stopSounds() {
    const now = this.ctx.audio.ctx?.currentTime ?? 0;
    for (const v of [this.rant, this.hum]) {
      if (!v) continue;
      v.src.onended = null; v.g.gain.setTargetAtTime(0, now, 0.08);
      try { v.src.stop(now + 0.4); } catch { /* already stopped */ }
    }
    this.rant = this.hum = null;
  }

  leave() {
    this.stopSounds();
    if (this.npc && !this.npc.done) this.npc.remove();
    this.npc = null; this.want = this.ext = 0; this.light.intensity = 0;
  }
  clear() { this.leave(); }
}
