// Stage screen modes: live Leno cams (default), a YouTube video, or a lime full-bright green screen.
//
// YouTube on the big screen: a cross-origin player can't be drawn into a WebGL texture, so the real iframe is
// placed in 3D with CSS3DRenderer exactly over the backdrop screen, *behind* the WebGL canvas, and the screen
// mesh punches a transparent hole into the canvas (NoBlending, alpha 0). Anything in front of the screen
// (Leno, lights) still occludes the video correctly.
//
// The fly sees the screen: every ~100 ms the screen's picture is reduced to left/right halves of brightness and
// motion (frame-to-frame change), weighted by how much the screen is in Leno's field of view and on which side,
// and drives sampled R1-6 photoreceptors of the left/right eye. Sources of the picture:
//   cams  -> the live-cam render target (read back from the GPU)
//   green -> constant bright field (no motion)
//   video -> the tab capture's video track (the same "pipe tab audio" capture that lets the fly hear); without
//            it the video can't be seen by the fly (browsers don't expose cross-origin iframe pixels)
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { loadYouTubeApi } from './youtube.js';

const W = 32, H = 14;                               // vision sample grid

export function parseYouTubeId(s) {
  if (!s) return null;
  const m = s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
}

export class StageScreens {
  constructor({ renderer, scene, camera, stage, viewport, liveCams, hearing, getHost, stimAlias, onChange }) {
    Object.assign(this, { renderer, scene, camera, stage, liveCams, hearing, getHost, stimAlias, onChange });
    this.mode = 'cams';
    this.big = stage.root?.getObjectByName('BackdropScreen');
    this.sides = ['SideScreensUpper', 'SideScreensLower'].map((n) => stage.root?.getObjectByName(n)).filter(Boolean);
    this.available = !!(this.big && stage.screens?.big);
    if (!this.available) return;
    this.camMats = { big: this.big.material, sides: this.sides.map((m) => m.material) };
    this.greenMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, toneMapped: false });
    this.holeMat = new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending });
    // CSS3D layer under the WebGL canvas
    this.css = new CSS3DRenderer();
    Object.assign(this.css.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none', zIndex: '0' });
    viewport.insertBefore(this.css.domElement, viewport.firstChild);
    this.pxW = 1280; this.pxH = Math.round(1280 * (this.screenSize().h / this.screenSize().w));
    const el = document.createElement('div');
    Object.assign(el.style, { width: this.pxW + 'px', height: this.pxH + 'px', background: '#000' });
    const holder = document.createElement('div'); el.appendChild(holder);
    this.cssObj = new CSS3DObject(el);
    this.cssObj.visible = false;
    this.cssScene = new THREE.Scene(); this.cssScene.add(this.cssObj);
    this.el = el; this.holder = holder;
    this.videoId = 'ki3ssj466E0';                     // default: The Grey Leno Show
    this.master = 1; this.volume = 70;
    // vision
    this.canvas = document.createElement('canvas'); this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.prev = null; this.visT = 0; this.rates = { L: 0, R: 0 }; this.visionNote = '';
    this.rtBuf = null;
  }

  screenSize() {
    const box = new THREE.Box3().setFromObject(this.big), s = box.getSize(new THREE.Vector3());
    return { w: Math.max(s.x, s.z), h: s.y };
  }

  resize(w, h) { this.css?.setSize(w, h); }

  setVolume(v, master = this.master) { this.volume = v; this.master = master; if (this.player?.setVolume) this.player.setVolume(v * master); }

  async setMode(mode, videoId) {
    if (!this.available) return;
    if (videoId) this.videoId = videoId;
    if (this.card) this.clearCard(false);
    this.mode = mode;
    this.big.material = mode === 'green' ? this.greenMat : mode === 'video' ? this.holeMat : this.camMats.big;
    this.sides.forEach((m, i) => (m.material = mode === 'green' ? this.greenMat : this.camMats.sides[i]));
    this.greenGlow = mode === 'green';          // main loop tints the screen spill light
    this.cssObj.visible = mode === 'video';
    if (mode === 'video') await this.playVideo(this.videoId);
    else this.player?.pauseVideo?.();
    this.prev = null;
    this.onChange?.(mode);
  }

  async playVideo(id) {
    const YT = await loadYouTubeApi();
    if (!this.player) {
      await new Promise((resolve) => {
        this.player = new YT.Player(this.holder, {
          width: this.pxW, height: this.pxH, videoId: id,
          playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, modestbranding: 1, loop: 1, playlist: id, cc_load_policy: 0, iv_load_policy: 3, disablekb: 1, origin: location.origin },
          events: {
            onReady: (e) => { e.target.setVolume(this.volume * this.master); e.target.unMute(); e.target.playVideo(); resolve(); },
            onStateChange: (e) => { if (e.data === 0) e.target.playVideo(); this.onChange?.(this.mode); },
            onError: (e) => { this.visionNote = `YouTube error ${e.data}`; this.onChange?.(this.mode); resolve(); },
          },
        });
      });
      this.iframe = this.el.querySelector('iframe');
    } else if (this.player.getVideoData?.().video_id !== id) {
      this.player.loadVideoById(id);
    } else this.player.playVideo();
  }

  title() { return this.player?.getVideoData?.().title || ''; }

  /** put a show card (js/cards.js) on every screen for `secs` seconds, then go back to the current mode */
  showCard(card, secs = 8) {
    if (!this.available) return;
    this.clearCard(false);
    const tex = new THREE.CanvasTexture(card.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    this.card = { card, tex, mat, t: 0, until: secs };
    this.big.material = mat; this.sides.forEach((m) => (m.material = mat));
    this.cssObj.visible = false;
    this.greenGlow = false;                     // show cards take over whatever mode is chosen; the mode comes back after
    if (this.mode === 'video') this.player?.pauseVideo?.();
    this.prev = null;
  }

  clearCard(restore = true) {
    if (!this.card) return;
    this.card.tex.dispose(); this.card.mat.dispose();
    this.card = null;
    if (restore) this.setMode(this.mode);
  }

  update(dt) {
    if (!this.available) return;
    if (this.card) {
      const c = this.card; c.t += dt; c.card.draw(c.t); c.tex.needsUpdate = true;
      if (c.t >= c.until) this.clearCard();
    }
    if (this.mode === 'video' && !this.card) {
      this.big.updateMatrixWorld(true);
      this.big.getWorldPosition(this.cssObj.position);
      this.big.getWorldQuaternion(this.cssObj.quaternion);
      const { w } = this.screenSize();
      this.cssObj.scale.setScalar(w / this.pxW);
      this.css.render(this.cssScene, this.camera);
    }
    this.visT += dt;
    if (this.visT >= 0.1) { this.see(this.visT); this.visT = 0; }
  }

  // ---- the fly's view of the screen -------------------------------------------------------------------
  sample() {
    const ctx = this.ctx;
    if (this.card) { ctx.drawImage(this.card.card.canvas, 0, 0, W, H); return true; }
    if (this.mode === 'green') { ctx.fillStyle = '#00ff00'; ctx.fillRect(0, 0, W, H); return true; }
    if (this.mode === 'cams') {
      // what the show cam shows, rendered small into a plain (non-multisampled) target and read back
      const cam = this.liveCams?.show?.cam;
      if (!cam) return false;
      this.visRT ||= new THREE.WebGLRenderTarget(64, 28);
      const rt = this.visRT, w = rt.width, h = rt.height, r = this.renderer, prevRT = r.getRenderTarget();
      r.setRenderTarget(rt); r.render(this.scene, cam); r.setRenderTarget(prevRT);
      this.rtBuf ||= new Uint8Array(w * h * 4);
      r.readRenderTargetPixels(rt, 0, 0, w, h, this.rtBuf);
      const img = ctx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const sx = Math.floor((x + 0.5) * w / W), sy = Math.floor((1 - (y + 0.5) / H) * h);
        const i = (sy * w + sx) * 4, o = (y * W + x) * 4;
        img.data[o] = this.rtBuf[i]; img.data[o + 1] = this.rtBuf[i + 1]; img.data[o + 2] = this.rtBuf[i + 2]; img.data[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return true;
    }
    // video: crop the iframe's on-screen rectangle out of the tab capture
    const v = this.hearing?.captureVideo;
    if (!v || !v.videoWidth || !this.iframe) { this.visionNote = 'fly can\'t see the video: use "pipe tab audio" (shares the tab picture too)'; return false; }
    const r = this.iframe.getBoundingClientRect();
    const sx = v.videoWidth / innerWidth, sy = v.videoHeight / innerHeight;
    const x0 = Math.max(0, r.left * sx), y0 = Math.max(0, r.top * sy);
    const x1 = Math.min(v.videoWidth, r.right * sx), y1 = Math.min(v.videoHeight, r.bottom * sy);
    if (x1 - x0 < 4 || y1 - y0 < 4) { this.visionNote = 'screen out of view'; return false; }
    ctx.drawImage(v, x0, y0, x1 - x0, y1 - y0, 0, 0, W, H);
    this.visionNote = '';
    return true;
  }

  see(dt) {
    if (!this.stimAlias) return;
    const ok = this.sample();
    let L = 0, R = 0, lumL = 0, lumR = 0, motL = 0, motR = 0;
    if (ok) {
      const d = this.ctx.getImageData(0, 0, W, H).data, lum = new Float32Array(W * H);
      for (let i = 0; i < W * H; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, m = this.prev ? Math.abs(lum[i] - this.prev[i]) : 0;
        if (x < W / 2) { lumL += lum[i]; motL += m; } else { lumR += lum[i]; motR += m; }
      }
      const n = (W * H) / 2;
      lumL /= n; lumR /= n; motL /= n; motR /= n;
      this.prev = lum;
      // how much of the screen is in the fly's view, and on which side (flies see ~330°, so only directly
      // behind is blind); the screen's left half lands more on the left eye when it's straight ahead
      const host = this.getHost(), fwd = host.forward(), pos = host.position ?? host.root.position;
      const to = this.big.getWorldPosition(new THREE.Vector3()).sub(pos).setY(0).normalize();
      const facing = fwd.dot(to), side = fwd.z * to.x - fwd.x * to.z;          // side > 0: screen on Leno's left
      const vis = THREE.MathUtils.clamp(0.55 + 0.45 * facing, 0, 1) * (facing < -0.85 ? 0 : 1);
      const toLeft = THREE.MathUtils.clamp(0.5 + 0.5 * side, 0, 1);
      const drive = (lum, mot) => 6 + 25 * lum + 400 * mot;                     // tonic + brightness + motion
      const a = drive(lumL, motL), b = drive(lumR, motR);
      if (facing > 0.3) { L = vis * a; R = vis * b; }                        // ahead: each half on its eye
      else { const m = (a + b) / 2; L = vis * m * toLeft; R = vis * m * (1 - toLeft); }   // off to one side
      L = Math.min(90, L * (this.gain ?? 1)); R = Math.min(90, R * (this.gain ?? 1));
    }
    this.rates = { L, R, lumL, lumR, motL, motR };
    this.stimAlias('visL', 'eyeL', L);
    this.stimAlias('visR', 'eyeR', R);
  }
}
