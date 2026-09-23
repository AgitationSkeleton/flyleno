// Live neural map: every neuron of the model at its FlyWire soma position, lit by its spikes.
// Positions: measured soma, else the annotation's representative point, else a deterministic
// layout near its super-class centroid (tools/build_connectome.py -> data/positions.bin.gz).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DECAY_PER_S = 6;          // glow decays ~e-fold in 1/6 s

export class NeuroMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050608);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
    this.camera.position.set(0, 0, 2.9);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 1.5; this.controls.maxDistance = 8;
    this.autoRotate = false;
  }

  async load(url = 'data/positions.bin.gz') {
    const res = await fetch(url);
    const raw = new Uint8Array(await new Response(res.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const dv = new DataView(raw.buffer);
    const N = dv.getUint32(4, true);
    const q = new Int16Array(raw.buffer.slice(12, 12 + N * 6));
    const pos = new Float32Array(N * 3);
    // FlyWire: x lateral, y dorsal->ventral, z anterior->posterior. Front view: x right, y up.
    for (let i = 0; i < N; i++) {
      pos[i * 3] = -q[i * 3] / 32767;
      pos[i * 3 + 1] = -q[i * 3 + 1] / 32767;
      pos[i * 3 + 2] = -q[i * 3 + 2] / 32767;
    }
    this.N = N;
    this.act = new Float32Array(N);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.actAttr = new THREE.BufferAttribute(this.act, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('act', this.actAttr);
    this.dead = new Float32Array(N);                   // cells eaten by the brain worms
    this.deadAttr = new THREE.BufferAttribute(this.dead, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('dead', this.deadAttr);
    this.pos = pos;
    geo.computeBoundingSphere();
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uSize: { value: 1.6 * Math.min(devicePixelRatio, 2) } },
      vertexShader: /* glsl */`
        attribute float act; attribute float dead; varying float vAct; varying float vDead; uniform float uSize;
        void main() {
          vAct = act; vDead = dead;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * (1.0 + 1.8 * act) * (3.0 / -mv.z);
        }`,
      fragmentShader: /* glsl */`
        varying float vAct; varying float vDead;
        void main() {
          vec2 d = gl_PointCoord - 0.5; if (dot(d, d) > 0.25) discard;
          vec3 base = vec3(0.16, 0.62, 0.66) * 0.16;     // teal
          vec3 hot = vec3(1.0, 0.78, 0.30);              // gold
          vec3 c = mix(base, hot, clamp(vAct, 0.0, 1.0));
          gl_FragColor = vec4(vDead > 0.5 ? vec3(0.22, 0.015, 0.03) : c, 1.0);   // eaten: dark red
        }`,
    });
    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
    this.resize();
    addEventListener('resize', () => this.resize());
    return this;
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** spikes: Int32Array of neuron indices that fired since the last call */
  addSpikes(spikes) {
    if (!this.act) return;
    const a = this.act;
    for (let k = 0; k < spikes.length; k++) { const i = spikes[k]; a[i] = Math.min(1, a[i] + 0.6); }
  }

  /** brain worms: `on` shows the worms crawling through the map; eaten cells turn dark red */
  setWorms(on) {
    if (!this.pos) return;
    if (on && !this.worms) {
      this.worms = Array.from({ length: 5 }, () => {
        const n = 14, pts = new Float32Array(n * 3), i = (Math.random() * this.N) | 0;
        for (let k = 0; k < n; k++) pts.set([this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]], k * 3);
        const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pts, 3).setUsage(THREE.DynamicDrawUsage));
        const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff7ab0, transparent: true, opacity: 0.95 }));
        line.frustumCulled = false; this.points.add(line);
        return { line, pts, target: null, t: Math.random() * 6 };
      });
    }
    this.worms?.forEach((w) => (w.line.visible = on));
    this.wormsOn = on;
  }

  markEaten(indices) {
    if (!this.dead || !indices?.length) return;
    for (const i of indices) this.dead[i] = 1;
    this.deadAttr.needsUpdate = true;
    // each worm heads for one of the latest meals
    this.worms?.forEach((w) => { const i = indices[(Math.random() * indices.length) | 0]; w.target = [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; });
  }

  heal() { if (this.dead) { this.dead.fill(0); this.deadAttr.needsUpdate = true; } }

  crawl(dt) {
    for (const w of this.worms || []) {
      if (!w.line.visible) continue;
      w.t += dt;
      const p = w.pts, n = p.length / 3;
      const tgt = w.target || [0, 0, 0];
      const dx = tgt[0] - p[0], dy = tgt[1] - p[1], dz = tgt[2] - p[2], d = Math.hypot(dx, dy, dz) || 1;
      const sp = Math.min(d, 0.35 * dt);
      const wig = 0.012 * Math.sin(w.t * 9);
      p[0] += dx / d * sp + wig * (dz / d); p[1] += dy / d * sp; p[2] += dz / d * sp - wig * (dx / d);
      for (let k = 1; k < n; k++) {                   // body segments follow at a fixed spacing
        const a = (k - 1) * 3, b = k * 3;
        const ex = p[b] - p[a], ey = p[b + 1] - p[a + 1], ez = p[b + 2] - p[a + 2], L = Math.hypot(ex, ey, ez) || 1, seg = 0.012;
        if (L > seg) { p[b] = p[a] + ex / L * seg; p[b + 1] = p[a + 1] + ey / L * seg; p[b + 2] = p[a + 2] + ez / L * seg; }
      }
      w.line.geometry.attributes.position.needsUpdate = true;
    }
  }

  render(dt) {
    if (!this.act) return;
    this.crawl(dt);
    const f = Math.exp(-DECAY_PER_S * dt), a = this.act;
    for (let i = 0; i < a.length; i++) if (a[i] > 0.002) a[i] *= f; else a[i] = 0;
    this.actAttr.needsUpdate = true;
    if (this.autoRotate) this.points.rotation.y += dt * 0.25;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }
}
