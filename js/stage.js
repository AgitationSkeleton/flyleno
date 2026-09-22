// Loads the TUURD Talk stage (assets/tuurd_talk_stage.glb) + its marker data.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Unity light intensities/ranges don't map to physical units; scale to taste.
const LIGHT_GAIN = 3;

export async function loadStage(scene, { onProgress, lite = false } = {}) {
  const [gltf, markers] = await Promise.all([
    new GLTFLoader().loadAsync('assets/tuurd_talk_stage.glb', (e) => onProgress?.('stage', e)),
    fetch('assets/tuurd_talk_markers.json').then((r) => r.json()),
  ]);
  const root = gltf.scene;
  const ground = [];
  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = true;
      // Walkable surfaces for Leno's ground ray.
      if (/^(SpeakingPlatform|FLoor)$/.test(o.name) || /^(SpeakingPlatform|FLoor)$/.test(o.parent?.name)) ground.push(o);
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.anisotropy = 4;
      }
    }
    if (o.isLight) {
      if (lite) { o.visible = false; return; }
      o.intensity = (o.intensity || 1) * LIGHT_GAIN;
      o.decay = 1;
      if (o.distance === 0 || !isFinite(o.distance)) o.distance = 30;
    }
  });
  scene.add(root);
  const screens = await setupScreens(root);

  // Marker helpers (hidden by default, toggle from the UI)
  const markerGroup = new THREE.Group();
  markerGroup.name = 'MarkerHelpers';
  markerGroup.visible = false;
  const seatGeo = new THREE.ConeGeometry(0.18, 0.5, 8);
  const seatMat = new THREE.MeshBasicMaterial({ color: 0x33ccff });
  const seats = new THREE.InstancedMesh(seatGeo, seatMat, markers.audience.length);
  const m4 = new THREE.Matrix4();
  markers.audience.forEach((a, i) => {
    m4.makeTranslation(a.position[0], a.position[1] + 0.4, a.position[2]);
    seats.setMatrixAt(i, m4);
  });
  markerGroup.add(seats);
  const hostHelper = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.8, 32), new THREE.MeshBasicMaterial({ color: 0xff3366, side: THREE.DoubleSide }));
  hostHelper.rotation.x = -Math.PI / 2;
  hostHelper.position.fromArray(markers.stageCenter ? [markers.host.position[0], markers.stageCenter.position[1] + 0.02, markers.host.position[2]] : markers.host.position);
  markerGroup.add(hostHelper);
  scene.add(markerGroup);

  return { root, markers, ground, markerGroup, screens };
}

// The show's backdrop images (exported from ShowBgImages/TuurdTalk) cycle on the big video
// screen and the side-wall image panels, like in the game.
const SCREEN_MATERIALS = ['VideoNormal Optimized', 'BgImageMaterial', 'BgImageMaterial 2'];
const SCREEN_PERIOD = 9; // seconds per image

async function setupScreens(root) {
  let names = [];
  try { names = await fetch('assets/show_bg/index.json').then((r) => (r.ok ? r.json() : [])); } catch { /* optional */ }
  const slots = SCREEN_MATERIALS.map(() => []);
  root.traverse((o) => {
    if (!o.isMesh) return;
    const i = SCREEN_MATERIALS.indexOf(o.material?.name);
    if (i >= 0) slots[i].push(o);
  });
  if (!names.length) return { update() {} };
  const loader = new THREE.TextureLoader();
  const cache = new Map();
  const tex = (n) => {
    if (!cache.has(n)) {
      const t = loader.load('assets/show_bg/' + n);
      t.colorSpace = THREE.SRGBColorSpace;
      t.flipY = false; // glTF UV convention
      cache.set(n, t);
    }
    return cache.get(n);
  };
  const mats = slots.map((meshes) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xdddddd });
    meshes.forEach((o) => (o.material = m));
    return m;
  });
  let shown = -1;
  return {
    update(t) {
      const k = Math.floor(t / SCREEN_PERIOD);
      if (k === shown) return;
      shown = k;
      mats.forEach((m, i) => { m.map = tex(names[(k + i * 7) % names.length]); m.needsUpdate = true; });
    },
  };
}
