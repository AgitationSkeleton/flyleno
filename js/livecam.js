// Live studio cameras: the stage's video walls show cameras that follow Leno, rendered into textures.
//   big backdrop screen      -> "show cam": in front of Leno, framing him head to toe
//   side screens (upper pair)-> "face cam": close-up of his head
//   side screens (lower pair)-> "show cam" again
import * as THREE from 'three';

export class LiveCams {
  constructor(renderer, scene, screens, getHost) {
    this.renderer = renderer; this.scene = scene; this.getHost = getHost;
    const mk = (w, h) => {
      const rt = new THREE.WebGLRenderTarget(w, h, { samples: 2 });
      rt.texture.colorSpace = THREE.SRGBColorSpace;
      return rt;
    };
    this.show = { rt: mk(768, 322), cam: new THREE.PerspectiveCamera(32, 768 / 322, 0.1, 200), pos: new THREE.Vector3(), look: new THREE.Vector3() };
    this.face = { rt: mk(384, 198), cam: new THREE.PerspectiveCamera(24, 384 / 198, 0.05, 200), pos: new THREE.Vector3(), look: new THREE.Vector3() };
    const use = (mat, rt) => { if (!mat) return; mat.map = rt.texture; mat.toneMapped = true; mat.color?.set(0xffffff); mat.needsUpdate = true; };
    use(screens.big?.mat, this.show.rt);
    use(screens.sideA?.mat, this.face.rt);
    use(screens.sideB?.mat, this.show.rt);
    // the canvas graphics no longer need redrawing; keep the glow-light colour drift
    const glowOnly = screens.update.bind(screens);
    screens.update = (t) => { if (screens.glow) glowOnly(t); };
    for (const s of [screens.big, screens.sideA, screens.sideB]) if (s) s.draw = () => {};
    this.frame = 0;
    this.enabled = true;
  }

  update(dt) {
    if (!this.enabled) return;
    const h = this.getHost();
    const p = h.position ?? h.root.position, f = h.forward();
    const k = 1 - Math.exp(-dt * 2.5);
    // show cam: 8 m in front, a little to the side, chest height
    this.show.pos.lerp(p.clone().addScaledVector(f, 8).add(new THREE.Vector3(f.z * 1.5, 2.6, -f.x * 1.5)), k);
    this.show.look.lerp(p.clone().add(new THREE.Vector3(0, 1.4, 0)), k * 1.6);
    // face cam: close, at head height
    const head = h.state?.headPos ?? p.clone().add(new THREE.Vector3(0, 2.3, 0));
    this.face.pos.lerp(head.clone().addScaledVector(f, 2.2).add(new THREE.Vector3(-f.z * 0.4, 0.15, f.x * 0.4)), k * 1.5);
    this.face.look.lerp(head, k * 2);
    // render at half the display rate, alternating the two cameras
    this.frame++;
    const c = this.frame % 4 === 0 ? this.show : this.frame % 4 === 2 ? this.face : null;
    if (!c) return;
    c.cam.position.copy(c.pos); c.cam.lookAt(c.look);
    const r = this.renderer, prev = r.getRenderTarget();
    r.setRenderTarget(c.rt);
    r.render(this.scene, c.cam);
    r.setRenderTarget(prev);
  }
}
