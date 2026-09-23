// Particle effects: vomit stream from Leno's mouth, fart clouds from behind.
import * as THREE from 'three';

const MAX = 1500;

export class FX {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 3);
    this.size = new Float32Array(MAX);
    this.vel = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);      // remaining s (0 = dead)
    this.kind = new Uint8Array(MAX);        // 1 vomit, 2 gas
    this.floor = new Float32Array(MAX);     // per-particle floor height
    this.next = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = step(0.001, size); vec4 mv = modelViewMatrix*vec4(position,1.);
        gl_Position = projectionMatrix*mv; gl_PointSize = size * 300. / -mv.z; }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ vec2 d = gl_PointCoord-.5; float r = dot(d,d); if(r>.25) discard;
        gl_FragColor = vec4(vC, vA*(1.-r*3.)); }`,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.emitters = [];
    this.floorY = 1.17;
  }

  /** stream for `dur` seconds from getOrigin() in direction getDir() */
  vomit(getOrigin, getDir, dur = 1.2) { this.emitters.push({ kind: 1, getOrigin, getDir, until: dur, rate: 500 }); }
  /** one-off burst of tomato juice / pulp at `p` */
  splash(p, n = 60) {
    for (let k = 0; k < n; k++) {
      const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).normalize().multiplyScalar(0.4 + Math.random() * 0.6);
      this.spawn(1, p, d, [0.75 + Math.random() * 0.2, 0.05 + Math.random() * 0.08, 0.04], p.y - 0.12);
    }
  }

  fart(getOrigin, getDir) { this.emitters.push({ kind: 2, getOrigin, getDir, until: 0.5, rate: 120 }); }

  spawn(kind, o, d, color = null, floor = null) {
    const i = this.next; this.next = (this.next + 1) % MAX;
    const j = i * 3;
    this.pos[j] = o.x; this.pos[j + 1] = o.y; this.pos[j + 2] = o.z;
    const sp = kind === 1 ? 3.2 : 0.5, jit = kind === 1 ? 0.6 : 0.5;
    this.vel[j] = d.x * sp + (Math.random() - 0.5) * jit;
    this.vel[j + 1] = d.y * sp + (Math.random() - 0.5) * jit + (kind === 2 ? 0.25 : 0.4);
    this.vel[j + 2] = d.z * sp + (Math.random() - 0.5) * jit;
    this.life[i] = kind === 1 ? 2.5 : 2.2;
    this.kind[i] = kind;
    this.floor[i] = floor ?? this.floorY;
    const c = color || (kind === 1 ? [0.55 + Math.random() * 0.15, 0.62 + Math.random() * 0.15, 0.12] : [0.55, 0.62, 0.35]);
    this.col[j] = c[0]; this.col[j + 1] = c[1]; this.col[j + 2] = c[2];
    this.size[i] = kind === 1 ? 0.05 + Math.random() * 0.05 : 0.25 + Math.random() * 0.2;
  }

  update(dt) {
    for (const e of this.emitters) {
      e.until -= dt;
      const n = Math.round(e.rate * dt * (0.6 + Math.random() * 0.8));
      const o = e.getOrigin(), d = e.getDir();
      for (let k = 0; k < n; k++) this.spawn(e.kind, o, d);
    }
    this.emitters = this.emitters.filter((e) => e.until > 0);
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      const j = i * 3;
      this.life[i] -= dt;
      if (this.kind[i] === 1) {
        this.vel[j + 1] -= 9.8 * dt;
        if (this.pos[j + 1] <= this.floor[i]) { this.pos[j + 1] = this.floor[i] + 0.01; this.vel[j] *= 0.3; this.vel[j + 1] = 0; this.vel[j + 2] *= 0.3; }
      } else {
        this.vel[j] *= 1 - dt; this.vel[j + 1] *= 1 - dt; this.vel[j + 2] *= 1 - dt;
        this.size[i] += dt * 0.25;
        this.col[j + 1] = 0.62 * Math.min(1, this.life[i]);   // fades out
      }
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.life[i] <= 0) this.size[i] = 0;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.color.needsUpdate = a.size.needsUpdate = true;
  }
}
