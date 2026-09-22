import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadStage } from './stage.js';
import { Leno } from './leno.js';
import { Sidebar } from './ui.js';
import { decodeMotor, motorGains } from './motor.js';
import { Director } from './director.js';

const params = new URLSearchParams(location.search);
const LITE = params.has('lite');           // no scene point lights, 1x pixel ratio (slow GPUs / headless tests)
const loadingText = document.getElementById('loadingText');
const setLoading = (t) => { loadingText.textContent = t; console.log('[flyleno]', t); };

// ------------------------------------------------------------------ renderer / scene
const canvas = document.getElementById('three');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.85;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07070a);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.add(new THREE.HemisphereLight(0xffffff, 0x302020, 0.5));
const key = new THREE.SpotLight(0xfff2e0, 180, 40, Math.PI / 9, 0.5, 1.2);
scene.add(key, key.target);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxDistance = 90;

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ------------------------------------------------------------------ load world
const progress = {};
const onProgress = (label, e) => {
  progress[label] = e.total ? `${label} ${(100 * e.loaded / e.total).toFixed(0)}%` : `${label} ${(e.loaded / 1e6).toFixed(1)} MB`;
  setLoading('Loading ' + Object.values(progress).join(' · '));
};

let stage, leno;
try {
  stage = await loadStage(scene, { onProgress, lite: LITE });
  leno = await new Leno().load('assets/grey_leno.glb', onProgress);
} catch (err) {
  setLoading('Could not load the 3D assets (assets/*.glb). These are not in the repository — run the export tools ' +
    'locally (see README). ' + err.message);
  throw err;
}
scene.add(leno.root);
leno.place(stage.markers.host, stage.ground, stage.markers.stageCenter);
const hostPos = leno.root.position.clone();
key.position.set(hostPos.x, hostPos.y + 14, hostPos.z + 10);
key.target.position.copy(hostPos);

// cameras
const camMarker = stage.markers.camera;
const cams = {
  audience: () => {
    const target = hostPos.clone().add(new THREE.Vector3(0, 2, 0));
    return { pos: new THREE.Vector3().fromArray(camMarker.position).lerp(target, 0.45), target };
  },
  wide: () => ({ pos: new THREE.Vector3().fromArray(camMarker.position), target: hostPos.clone().add(new THREE.Vector3(0, 2, 0)) }),
  close: () => {
    const p = leno.root.position;
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(leno.root.quaternion);
    return { pos: p.clone().addScaledVector(f, 6).add(new THREE.Vector3(0.8, 2.6, 0)), target: p.clone().add(new THREE.Vector3(0, 2.0, 0)) };
  },
  follow: () => {
    const p = leno.root.position;
    return { pos: p.clone().add(new THREE.Vector3(0, 5, 11)), target: p.clone().add(new THREE.Vector3(0, 1.6, 0)) };
  },
};
let camMode = 'audience';
function setCam(mode) {
  camMode = mode;
  document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
  if (cams[mode]) { const c = cams[mode](); camera.position.copy(c.pos); controls.target.copy(c.target); }
}
document.querySelectorAll('#cams button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));
controls.addEventListener('start', () => { if (camMode !== 'free') { camMode = 'free'; setCam('free'); } });
document.getElementById('showMarkers').onchange = (e) => (stage.markerGroup.visible = e.target.checked);
resize();
setCam('audience');

// ------------------------------------------------------------------ brain
setLoading('Loading fly brain (FlyWire v783, ~31 MB)…');
const meta = await fetch('data/neurons.json').then((r) => r.json());
const worker = new Worker(new URL('./brain-worker.js', import.meta.url));
const base = new URL('..', import.meta.url).href;
let sidebar;

const director = new Director((k, on) => sidebar?.setAuto(k, on), (text) => sidebar?.ticker(text));
sidebar = new Sidebar({
  meta,
  onStim: (s, rate) => worker.postMessage({ type: 'stim', key: s.key, indices: s.indices, rate }),
  onPause: (p) => worker.postMessage({ type: p ? 'pause' : 'run' }),
  onReset: () => worker.postMessage({ type: 'reset' }),
  onSpeed: (v) => worker.postMessage({ type: 'speed', value: v }),
  onAutopilot: (on) => { director.enabled = on; if (!on) director.stopAll(); },
});

let lastMotor = null, runawayMs = 0;
worker.onmessage = ({ data }) => {
  switch (data.type) {
    case 'progress':
      setLoading(`Loading fly brain… ${(data.got / 1e6).toFixed(1)}${data.total ? ' / ' + (data.total / 1e6).toFixed(1) : ''} MB`);
      break;
    case 'status': setLoading(data.text); sidebar.status(data.text); break;
    case 'ready':
      sidebar.setReady(data);
      sidebar.status('running', 'ok');
      document.getElementById('loading').classList.add('done');
      worker.postMessage({ type: 'run' });
      break;
    case 'tick': {
      // Some stimuli (e.g. Or56a) push the Shiu model into self-sustained runaway activity that
      // outlives the stimulus. Detect it (nothing stimulated, still >250k spikes/s for 2 s of sim).
      const anyStim = sidebar.manual.size + sidebar.auto.size > 0;
      runawayMs = !anyStim && data.spikesPerSec > 250e3 ? runawayMs + data.winMs : 0;
      if (runawayMs > 2000) {
        runawayMs = 0;
        if (director.enabled) director.commercialBreak(() => worker.postMessage({ type: 'reset' }));
        else sidebar.ticker('Runaway self-sustained activity: press Reset to calm the fly');
      }
      lastMotor = decodeMotor(data.rates, data.winMs);
      leno.setMotor(lastMotor.command);
      sidebar.update(data, lastMotor);
      break;
    }
    case 'error': sidebar.status('error: ' + data.message, 'warn'); setLoading('Brain error: ' + data.message); break;
  }
};
worker.postMessage({ type: 'init', base });

// ------------------------------------------------------------------ about
document.getElementById('aboutLink').onclick = (e) => {
  e.preventDefault();
  document.getElementById('aboutBody').innerHTML = `
    <p>A whole-brain spiking model of the adult fruit fly (${meta.N.toLocaleString()} neurons,
    ${meta.E.toLocaleString()} connections, ${meta.synapses.toLocaleString()} synapses) runs live in your browser and its
    descending neurons puppeteer Grey Leno on the TUURD Talk stage. Talk-show events stimulate the fly's sensory neurons.</p>
    <p><b>Brain model:</b> leaky integrate-and-fire network after Shiu et al. 2024, <i>Nature</i>
    (<a href="https://github.com/philshiu/Drosophila_brain_model">philshiu/Drosophila_brain_model</a>, MIT),
    connectome from FlyWire v783 (Dorkenwald et al. 2024; Schlegel et al. 2024), neuron IDs for stimuli/motor groups via
    <a href="https://github.com/erojasoficial-byte/fly-brain">erojasoficial-byte/fly-brain</a> (MIT).</p>
    <p><b>"Fictive" drives</b> stimulate descending neurons directly (as in Shiu et al.), the rest stimulate sensory neurons.</p>
    <p><b>Stage:</b> TUURD Talk set from <i>Nightmare Puppeteer</i>. <b>Grey Leno:</b> original model by Vinesauce, Dead as Disco port by huckleberrypie.
    These assets belong to their authors and are not distributed with this project.</p>`;
  document.getElementById('about').showModal();
};

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.05, clock.getDelta());
  director.update(dt);
  leno.update(dt);
  stage.screens.update(clock.elapsedTime);
  if (camMode === 'follow' || camMode === 'close') {
    const c = cams[camMode]();
    camera.position.lerp(c.pos, 1 - Math.exp(-dt * 3));
    controls.target.lerp(c.target, 1 - Math.exp(-dt * 5));
  }
  controls.update();
  renderer.render(scene, camera);
});

window.flyleno = { scene, camera, leno, stage, worker, director, motorGains, get motor() { return lastMotor; } };
