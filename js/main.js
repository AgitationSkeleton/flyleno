import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { loadOriginalStage } from './stage-original.js';
import { Leno } from './leno.js';
import { Sidebar } from './ui.js';
import { decodeMotor, motorGains } from './motor.js';
import { Director } from './director.js';
import { NeuroMap } from './neuromap.js';
import { AudioWorld } from './audio.js';
import { MusicPlayer } from './youtube.js';
import { Hearing } from './hearing.js';
import { Behavior } from './behavior.js';
import { Audience } from './audience.js';
import { Mind, ACTIONS, toPhones } from './mind.js';
import { FX } from './fx.js';
import { PhysicsLeno } from './body.js';
import { Cultists } from './cultists.js';
import { Projectiles } from './projectiles.js';
import { LiveCams } from './livecam.js';
import { Food } from './food.js';
import { Npcs } from './npcs.js';
import { Instincts } from './instincts.js';
import { FlyLeno } from './flybody.js';
import { StageScreens, parseYouTubeId } from './screens.js';
import { Brood } from './brood.js';
import { Goose } from './goose.js';
import { EntityColliders } from './colliders.js';
import { ShowSfx } from './showsfx.js';
import { Show, SEGMENTS } from './show.js';
import { Predators } from './predators.js';
import { Happenings } from './happenings.js';
import { propLOD } from './lod.js';
import { disposeObject } from './dispose.js';
import { NesGlitch } from './glitch.js';
import { FlyEyeView, humanFov, EgoVision } from './eyeview.js';
import { Wellbeing } from './wellbeing.js';
import { EventSwitches, buildEventsPanel } from './events.js';
import { Sleep } from './sleep.js';
import { ClownCar } from './clowns.js';
import { Jonkler } from './jonkler.js';
const wellbeing = new Wellbeing();                  // state of mind and body (read-outs for the Mind panel)
const switches = new EventSwitches();               // an on/off switch per event, and Peaceful Mode (the Events panel)
const sleep = new Sleep();                          // sleep pressure; dozing off when tired and safe
const allowed = (k) => switches.allowed(k);
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// YouTube embeds fail (error 150) on bare-IP origins such as 127.0.0.1, but work on localhost.
if (location.hostname === '127.0.0.1') { location.replace(location.href.replace('//127.0.0.1', '//localhost')); await new Promise(() => {}); }
// Tab capture (the fly hearing/seeing the tab) needs a secure context: on the published site, always use https.
if (location.protocol === 'http:' && location.hostname !== 'localhost') { location.replace(location.href.replace(/^http:/, 'https:')); await new Promise(() => {}); }
const params = new URLSearchParams(location.search);
const LITE = params.has('lite');           // no stage point lights, 1x pixel ratio (slow GPUs / headless tests)
// phones and tablets: a touch screen or a narrow window gets lower pixel densities (GPU memory is tight there)
const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth <= 760;
const STAGE = params.get('stage') || 'original';   // 'original' (procedural, default) | 'game' (exported GLB)
const BODY = params.get('body') || 'ragdoll';       // 'ragdoll' (physics, fly drives the muscles) | 'kinematic'
const $ = (id) => document.getElementById(id);
const loadingText = $('loadingText');
const setLoading = (t) => { loadingText.textContent = t; console.log('[flyleno]', t); };

// ------------------------------------------------------------------ renderer / scene
const canvas = $('three');
// alpha: the stage's YouTube screen is an iframe *behind* the canvas, shown through a transparent hole
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setPixelRatio(LITE ? 1 : Math.min(devicePixelRatio, MOBILE ? 1.5 : 2));
// if the browser reclaims the GPU context (memory pressure on phones), let three.js restore it instead of going blank
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[flyleno] WebGL context lost'); });
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

let stageScreens = null;
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  stageScreens?.resize(w, h);
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
  stage = STAGE === 'game'
    ? await (await import('./stage.js')).loadStage(scene, { onProgress, lite: LITE })
    : await loadOriginalStage(scene, { lite: LITE });
  leno = await new Leno().load('assets/grey_leno.glb', onProgress);
} catch (err) {
  setLoading('Could not load the 3D assets. The Grey Leno model (assets/grey_leno.glb) and the game stage are not in the ' +
    'repository; build them locally with the export tools (see README). ' + err.message);
  throw err;
}
const lenoPristine = cloneSkinned(leno.model);     // untouched copy for hatchlings (the host's bones get posed)
scene.add(leno.root);
leno.place(stage.markers.host, stage.ground, stage.markers.stageCenter);
const hostPos = leno.root.position.clone();
// `host` is what the rest of the app talks to: the physics ragdoll, or the kinematic puppet as fallback
let host = leno;
if (BODY === 'ragdoll') {
  try {
    setLoading('Starting physics (Rapier)…');
    host = await new PhysicsLeno(leno).init(stage, hostPos);
  } catch (e) {
    console.warn('ragdoll unavailable, using kinematic Leno', e);
    leno.place(stage.markers.host, stage.ground, stage.markers.stageCenter);
  }
}
const physHost = host !== leno ? host : null;       // the ragdoll body (null when unavailable)
// levels of detail for the instanced set pieces (built now that the colliders have read the full instance sets)
const stageLODs = stage.buildLODs ? stage.buildLODs() : [];
let flyHost = null;                                 // Fly-Leno body, created on first use
const hostAt = () => (host === leno ? leno.root.position : host.position);
key.position.set(hostPos.x, hostPos.y + 14, hostPos.z + 10);
key.target.position.copy(hostPos);
const fx = new FX(scene);
const cultists = new Cultists(scene, stage.markers.audience);
const liveCams = stage.screens?.big ? new LiveCams(renderer, scene, stage.screens, () => host) : null;
fx.floorY = hostPos.y + 0.01;

// cameras
const camMarker = stage.markers.camera;
const cams = {
  audience: () => {
    const target = hostPos.clone().add(new THREE.Vector3(0, 2, 0));
    return { pos: new THREE.Vector3().fromArray(camMarker.position).lerp(target, 0.45), target };
  },
  wide: () => ({ pos: new THREE.Vector3().fromArray(camMarker.position), target: hostPos.clone().add(new THREE.Vector3(0, 2, 0)) }),
  close: () => {
    const p = hostAt();
    const f = host.forward();
    return { pos: p.clone().addScaledVector(f, 6).add(new THREE.Vector3(0.8, 2.6, 0)), target: p.clone().add(new THREE.Vector3(0, 2.0, 0)) };
  },
  follow: () => {
    const p = hostAt();
    return { pos: p.clone().add(new THREE.Vector3(0, 5, 11)), target: p.clone().add(new THREE.Vector3(0, 1.6, 0)) };
  },
};
let camMode = 'audience';
// first-person views from Leno's head: 'eyes' (human field of view) and 'flyeyes' (the fly's compound eyes)
const EYE_MODES = new Set(['eyes', 'flyeyes']);
const eyeMode = () => EYE_MODES.has(camMode);
const flyEye = new FlyEyeView(96);
const ego = new EgoVision();                        // the fly's own eyesight (see the render loop)
let egoOn = true, egoT = 0;
const eyeRaw = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
const eyeS = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), init: false };
const CAM_FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);   // cameras look along -Z
/** the host's eye position and head orientation (the head looks along its local +Z) */
function eyePose() {
  if (host === flyHost) return flyHost.eyePose(eyeRaw.pos, eyeRaw.quat);
  if (host.rag) return host.rag.eyePose(eyeRaw.pos, eyeRaw.quat);
  const hb = leno.model.getObjectByName('head');                      // kinematic puppet fallback
  hb?.getWorldPosition(eyeRaw.pos);
  eyeRaw.pos.addScaledVector(host.forward(), 0.1).y += 0.05;
  eyeRaw.quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), host.forward());
  return eyeRaw;
}
// the fly sees out of its own head: humanoid Leno is one double-sided skinned mesh, so for the eye view he is drawn
// single-sided (from inside the head its surfaces face away and aren't drawn; his shoulders and body still are);
// Fly-Leno's head (with the antennae) is simply hidden while its eyes render
const lenoSkin = leno.model.getObjectByProperty('isSkinnedMesh', true);
const lenoMat = lenoSkin?.material, lenoMatFront = lenoMat?.clone();
if (lenoMatFront) lenoMatFront.side = THREE.FrontSide;
function hideHead(on) {
  if (host === flyHost) flyHost.head.visible = !on;
  else if (lenoSkin && lenoMatFront) lenoSkin.material = on ? lenoMatFront : lenoMat;
}
// Follow / Close-up keep tracking Leno when you orbit or zoom: the camera then rides along rigidly with its target
// (and turns with Leno's heading in Close-up) instead of snapping back. Clicking the mode again resets the view.
let camUser = false, camYaw = 0;
const hostYaw = () => { const f = host.forward(); return Math.atan2(f.x, f.z); };
const tracking = () => camMode === 'follow' || camMode === 'close';
function setCam(mode) {
  const wasEye = eyeMode();
  camMode = mode; camUser = false;
  controls.enabled = !eyeMode();
  if (eyeMode()) { camera.near = 0.02; eyeS.init = false; }
  else if (wasEye) { camera.near = 0.1; camera.fov = 45; camera.updateProjectionMatrix(); if (mode === 'free') controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(4)); }
  $('eyeNote').textContent = mode === 'eyes' ? 'human eyes, ~110°' : mode === 'flyeyes' ? 'fly eyes, ~320°' : '';
  document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
  if (cams[mode]) { const c = cams[mode](); camera.position.copy(c.pos); controls.target.copy(c.target); }
}
document.querySelectorAll('#cams button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));
controls.addEventListener('start', () => {
  if (tracking()) { camUser = true; camYaw = hostYaw(); }
  else if (camMode !== 'free') setCam('free');
});
$('showMarkers').onchange = (e) => (stage.markerGroup.visible = e.target.checked);
// hide the sidebar; fullscreen (hides the sidebar and asks the browser for real fullscreen where it can); hide the
// overlay buttons
function setFull(on) {
  $('app').classList.toggle('full', on); $('btnFull').classList.toggle('on', on);
  if (on) document.documentElement.requestFullscreen?.().catch(() => {});
  else if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
}
$('btnFull').onclick = () => setFull(!$('app').classList.contains('full'));
$('btnSide').onclick = () => {
  const on = !$('app').classList.contains('noside');
  $('app').classList.toggle('noside', on); $('btnSide').classList.toggle('on', on);
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
};
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && $('app').classList.contains('full')) setFull(false); });
$('btnBare').onclick = () => { const on = !$('viewport').classList.contains('bare'); $('viewport').classList.toggle('bare', on); $('btnBare').classList.toggle('on', on); };
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'f' || e.key === 'F') $('btnFull').click();
  if (e.key === 'h' || e.key === 'H') $('btnBare').click();
  if (e.key === 's' || e.key === 'S') $('btnSide').click();
});
resize();
setCam('audience');

// ------------------------------------------------------------------ brain
setLoading('Loading fly brain (FlyWire v783, ~31 MB)…');
const meta = await fetch('data/neurons.json').then((r) => r.json());
const worker = new Worker(new URL('./brain-worker.js', import.meta.url));
const base = new URL('..', import.meta.url).href;
const stimByKey = Object.fromEntries(meta.stimuli.map((s) => [s.key, s]));
let sidebar;

// direct, rate-only stimulation of internal groups (ambience, hearing, reinforcement)
const sentIdx = new Set(), lastRate = {};
function stimRate(k, rate) {
  if (Math.abs((lastRate[k] ?? -1) - rate) < 0.5 && !(rate === 0 && lastRate[k] !== 0)) return;
  lastRate[k] = rate;
  const msg = { type: 'stim', key: k, rate };
  if (!sentIdx.has(k)) { msg.indices = stimByKey[k].indices; sentIdx.add(k); }
  worker.postMessage(msg);
}
const reinforceTimers = {};
function reinforce(valence, seconds) {
  wellbeing.reinforced(valence);
  const k = valence >= 0 ? 'reward' : 'punish';
  stimRate(k, 40 * Math.min(1, Math.abs(valence)));
  clearTimeout(reinforceTimers[k]);
  reinforceTimers[k] = setTimeout(() => stimRate(k, 0), seconds * 1000);
}
// short stimulus pulse on a named group under its own key (so it does not clash with UI-managed stimuli)
const pulseTimers = {};
// how much a sensory pulse jolts him when he's asleep (and what woke him)
const JOLT = { hitTouch: [1.5, 'a hit'], hitTaste: [0.4, 'a splat'], rigTouch: [2, 'a crash'], swatHit: [2, 'a swat'], zapTouch: [2, 'a zap'],
  spiderGrab: [2, 'a grab'], spiderBump: [1.5, 'a bump'], alienKick: [1, 'a kick'], frogHit: [1.5, "the frog's tongue"], fallTouch: [1.5, 'a fall'],
  rainTouch: [0.25, 'the rain'], boltTouch: [1.2, 'thunder'], contactTouch: [0.1, 'a nudge'], confettiTouch: [0.05, 'confetti'], roseTouch: [0.15, 'a rose'],
  sugarTouch: [0.05, 'a sugar cube'], pieHit: [1.5, 'a pie in the face'], bangHit: [2, 'a BANG!'], itch: [0.2, 'an itch'], loom: [0.9, 'something flying at him'], spiderLoom: [0.9, 'a spider'],
  swatLoom: [0.9, 'a swatter'], frogLoom: [0.9, "the frog's tongue"] };
function pulse(alias, group, rate, seconds) {
  wellbeing.sensed(alias, rate);
  const j = JOLT[alias]; if (j && sleep.asleep) { sleep.disturbWhy = j[1]; sleep.jolt(j[0]); }
  worker.postMessage({ type: 'stim', key: alias, indices: stimByKey[group].indices, rate });
  clearTimeout(pulseTimers[alias]);
  pulseTimers[alias] = setTimeout(() => worker.postMessage({ type: 'stim', key: alias, rate: 0 }), seconds * 1000);
}
// rate-controlled stimulus under an alias key (for continuous signals like looming or taste)
const aliasSent = new Set(), aliasRate = {};
function stimAlias(alias, group, rate) {
  if (Math.abs((aliasRate[alias] ?? -1) - rate) < 1 && !(rate === 0 && aliasRate[alias] > 0)) return;
  aliasRate[alias] = rate;
  const msg = { type: 'stim', key: alias, rate };
  if (!aliasSent.has(alias)) { msg.indices = stimByKey[group].indices; aliasSent.add(alias); }
  worker.postMessage(msg);
}
function setAmbience(x) { stimRate('ambientTaste', 5 * x); stimRate('ambientTouch', 1 * x); }

const getLeno = () => ({ pos: hostAt().clone() });
const director = new Director((k, on) => sidebar?.setAuto(k, on), (text) => sidebar?.ticker(text), {
  snack: () => { if (npcs.busy) return false; npcs.deliverSnack(getLeno, allowed('eclairs') && Math.random() < 0.25 ? 'eclair' : 'sugar'); return true; },
  heckler: () => { if (npcs.busy || audienceAway) return false; npcs.heckle(getLeno); return true; },
});
// the director's events, by switch
const DIRECTOR_SWITCH = { applause: 'cueApplause', snack: 'snacks', heckler: 'hecklers', tomato: 'cueBitter', walk: 'cueDrives', reverse: 'cueDrives' };
director.allow = (k) => allowed(DIRECTOR_SWITCH[k] ?? k);
const mind = new Mind((k, on) => sidebar?.setAuto(k, on));
sidebar = new Sidebar({
  meta,
  onStim: (s, rate) => worker.postMessage({ type: 'stim', key: s.key, indices: s.indices, rate }),
  onPause: (p) => setPaused(p),
  onReset: () => resetShow(),
  onSpeed: (v) => worker.postMessage({ type: 'speed', value: v }),
  onAutopilot: (on) => { director.enabled = on; if (!on) director.stopAll(); if (showReady) syncShowEnabled(); },
});

// ------------------------------------------------------------------ audio, music, hearing
const audio = new AudioWorld();
const music = new MusicPlayer($('music'));
music.init().catch((e) => { $('music').querySelector('.yt-title').textContent = 'YouTube player unavailable: ' + e.message; });
const hearing = new Hearing(audio, music);
hearing.onChange = () => {
  $('hearMode').textContent = hearing.mode === 'piped' ? 'hearing: tab audio (music waveform + stage)'
    : hearing.mode === 'internal' ? `hearing: stage sounds + music estimate${hearing.error ? ' (' + hearing.error + ')' : ''}` : 'hearing: off';
  $('pipeBtn').hidden = hearing.mode === 'piped';
};
$('pipeBtn').onclick = () => hearing.pipeTabAudio();

// ------------------------------------------------------------------ behaviour, audience, mind
const leftOrRight = () => {
  const p = hostAt().clone().project(camera);
  return Math.max(-1, Math.min(1, p.x));
};
const audience = new Audience(audio, reinforce, {
  onReact: (e) => {
    const verb = { cheer: 'cheers', laugh: 'laughs', applause: 'applauds', boo: 'boos', gasp: 'gasps' }[e.kind] || e.kind;
    const what = { speak: 'babbling', stroll: 'stroll', startle: 'flinch', groom: 'grooming', tomatoHit: 'tomato hit', pipeHit: 'pipe hit', eat: 'meal', burp: 'burp', fall: 'fall',
      eatPoop: 'goose-dropping snack', lay: 'egg', hatch: 'hatching', goose: 'goose', frogTongue: "frog's tongue", frogSpit: 'spit-out', frogBite: 'ankle bite',
      frogKicked: 'frog getting kicked out', backflip: 'backflip', backflipFail: 'missing backflip', spiderDrop: 'spider dropping him', swatHit: 'swat', zap: 'zap',
      alienKick: 'shin kick', rigHit: 'falling rig', powerUp: 'power-up', roseHit: 'rose', dodge: 'narrow escape', doze: 'host dozing off', pieHit: 'pie in the face', bang: 'BANG! flag' }[e.act] || e.act;
    sidebar.ticker(`Audience ${verb} at the ${what}`);
    cultists.react(e.kind, e.intensity);
    // an unhappy crowd throws things
    if (e.kind === 'boo' && Math.random() < 0.35) setTimeout(() => throwThing(Math.random() < 0.15 ? 'pipe' : 'tomato'), 400 + Math.random() * 900);
  },
});
audience.allowKind = (kind) => allowed(kind === 'boo' ? 'boos' : kind === 'gasp' ? 'gasps' : 'cheers');

// ------------------------------------------------------------------ projectiles (tomatoes, pipes)
const projectiles = host !== leno ? new Projectiles(scene, host, {
  onApproach: () => pulse('loom', 'heckler', 200, 0.35),
  onSplat: (p, onLeno, rest, kind, floor) => {
    fx.splash(p, 60, kind === 'pie');
    if (kind === 'pie') food.addPie(floor ?? rest ?? p);                     // a pie ends up on the floor either way: food
    else if (!onLeno) food.addTomato(rest ?? p);
  },
  onImpact: (it, { hitLeno, speed }) => {
    const p = it.mesh.position.clone().project(camera), pan = Math.max(-1, Math.min(1, p.x));
    if (it.kind === 'sugar') {
      // a sugar cube can't hurt him: a soft tick, and on him just a light touch
      showSfx.sting('thwack', { gain: 0.05 });
      if (hitLeno && !it.hitLeno) { it.hitLeno = true; pulse('sugarTouch', 'ambientTouch', 12, 0.2); }
      return;
    }
    if (it.kind === 'pie') {
      audio.sfx('splat', { pan, gain: Math.min(1.2, 0.5 + speed / 12) });
      if (!hitLeno) return;
      // a cream pie in the face: a big slapstick shove, hardly any harm, and it's sweet
      const dir = it.prevVel.clone().setY(0); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
      if (host === flyHost) flyHost.applyImpulse('thorax', dir.clone().multiplyScalar(200).add(new THREE.Vector3(0, 70, 0)));
      else pushHost(dir.clone().multiplyScalar(230).add(new THREE.Vector3(0, 60, 0)));
      pulse('pieHit', 'ambientTouch', 60, 0.4); pulse('pieTaste', 'sugarTaste', 70, 0.6); lastPieHit = performance.now();
      audience.react('pieHit');
      return;
    }
    if (hitLeno && host !== flyHost && !it.knocked && (it.kind === 'pipe' || it.kind === 'camera' || it.kind === 'light')) {
      it.knocked = true; loosenHost(it.kind === 'pipe' ? 150 : 300);
    }
    if (hitLeno && host === flyHost && !it.knocked) {
      it.knocked = true;
      const push = { tomato: 30, rose: 0, pipe: 140, camera: 260, light: 200 }[it.kind] ?? 60;
      if (push) flyHost.applyImpulse('thorax', it.prevVel.clone().setLength(push).add(new THREE.Vector3(0, push * 0.3, 0)));
    }
    const gain = Math.min(1.2, 0.3 + speed / 12);
    if (it.kind === 'rose') {
      // a rose: a soft landing, and on him a compliment (reward)
      showSfx.sting('thwack', { gain: 0.1 });
      if (hitLeno && !it.hitLeno) {
        it.hitLeno = true;
        pulse('roseTouch', 'ambientTouch', 20, 0.3); reinforce(0.6, 1.2); audience.react('roseHit');
        sidebar.ticker('A rose lands on Leno');
      }
      return;
    }
    if (it.kind === 'camera' || it.kind === 'light') {
      // a rig piece: clang, and the light's glass breaks on the first impact
      audio.sfx('pipe', { pan, gain: gain * 0.8 });
      if (it.kind === 'light' && it.clangs === 1) showSfx.sting('crash', { gain: 0.7 });
      if (hitLeno && !it.hitLeno) {
        it.hitLeno = true;
        pulse('rigTouch', 'ambientTouch', 100, 0.6); reinforce(-0.9, 1.2); crowdDo('gasp', 1); audience.react('rigHit');
        sidebar.ticker(`A falling ${it.kind === 'camera' ? 'camera' : 'stage light'} hits Leno!`);
      }
      return;
    }
    if (it.kind === 'pipe') audio.sfx('pipe', { pan, gain }); else audio.sfx('splat', { pan, gain });
    if (!hitLeno) return;
    if (it.kind === 'tomato') {
      pulse('hitTaste', 'tomato', 200, 0.8);                           // bitter juice on him
      pulse('hitTouch', 'ambientTouch', 40, 0.4);
      audience.react('tomatoHit');
    } else {
      pulse('hitTouch', 'ambientTouch', 90, 0.6);                      // a metal pipe hurts
      reinforce(-0.8, 1.0);
      audience.react('pipeHit');
    }
  },
}) : null;
if (projectiles) {
  projectiles.ground = stage.ground;                           // where missed tomatoes end up
  // a sugar cube that has landed becomes food on the floor
  projectiles.onRest = (it, p) => { if (it.kind === 'sugar') food.addSugar(p, it.mesh); };
}
let audienceAway = false;                         // the seats are empty (after the Rapture): no reactions, no throws
let lastPieHit = -1e9;
const THROW_SWITCH = { tomato: 'tomatoes', pipe: 'pipes', rose: 'roses', sugar: 'sugar' };
/** a cultist throws `kind`; `force`: from a button or a storm/segment that has checked its own switch already
 *  (Peaceful Mode still stops the harmful ones) */
function throwThing(kind, force = false) {
  const sw = THROW_SWITCH[kind];
  if (sw && (force ? switches.blocked(sw) : !allowed(sw))) { if (force) sidebar.ticker('Peaceful Mode: nothing harmful gets thrown'); return; }
  if (!projectiles) { sidebar.ticker('Throwing needs the physics body (not ?body=kinematic)'); return; }
  if (audienceAway) { sidebar.ticker('Nobody is in the seats to throw anything'); return; }
  projectiles.throw(kind, cultists.standRandom());
}
$('throwTomato').onclick = () => throwThing('tomato', true);
$('throwPipe').onclick = () => throwThing('pipe', true);
$('throwRose').onclick = () => throwThing('rose', true);
$('throwSugar').onclick = () => throwThing('sugar', true);
const behavior = new Behavior(meta, audio, {
  onEvent: (type, d) => {
    if (type === 'vomit') {
      // the stream starts with the sound and lasts about as long as it does
      wellbeing.vomited(); host.trigger('vomit');
      Promise.resolve(d.len).then((len) => setTimeout(() => fx.vomit(() => host.mouth(), () => host.headDown(), Math.max(1.1, Math.min(2.6, (len || 1.5) - 0.4))), 300));
    }
    if (type === 'retch') host.trigger('retch');
    if (type === 'fart') { host.trigger('fart'); fx.fart(() => host.butt(), () => host.forward().negate()); }
    if (type === 'speak') {
      if (d.lesson && d.lesson.score >= 0.5) reinforce(0.7, 0.6);          // the teacher's reward
      updateLesson();
    }
    audience.react(type, d);
  },
});

// motor "acts" the audience can react to (rising edges)
const edge = {};
function acts(cmd) {
  const on = { startle: cmd.startle > 0.6, groom: cmd.groom > 0.5, stroll: cmd.forward > 0.5 };
  for (const k in on) { if (on[k] && !edge[k]) audience.react(k); edge[k] = on[k]; }
}

// ------------------------------------------------------------------ lessons
let lessonTimer = null;
function updateLesson() {
  const L = behavior.lesson;
  $('lessonInfo').textContent = L ? `target /${L.phones.join(' ')}/ · progress ${L.pos}/${L.phones.length} · hits ${L.hits}` : '';
}
$('lessonBtn').onclick = () => {
  const text = $('lessonWord').value.trim();
  clearInterval(lessonTimer);
  if (!text || behavior.lesson?.text === text) { behavior.setLesson(null); $('lessonBtn').textContent = 'Teach'; updateLesson(); return; }
  behavior.setLesson(text, toPhones(text));
  $('lessonBtn').textContent = 'Stop';
  // the lesson stimulus: every few seconds a stagehand says the word (the fly hears it via JO)
  const sayIt = () => {
    if (!audio.ctx) return;
    const w = audio.word(text);
    if (!w) behavior.lesson.phones.forEach((ph, i) => setTimeout(() => audio.phoneme(ph, { gain: 0.8 }), i * 130));
  };
  sayIt(); lessonTimer = setInterval(sayIt, 5000);
  updateLesson();
};

// ------------------------------------------------------------------ settings
// Brain settings: browsers restore checkbox states on reload, so force the defaults and tell the worker
$('optAdapt').checked = false; $('optPlastic').checked = true;
worker.postMessage({ type: 'adaptation', params: { on: false } });
worker.postMessage({ type: 'plasticity', params: { enabled: true } });
$('optAdapt').onchange = (e) => worker.postMessage({ type: 'adaptation', params: { on: e.target.checked } });
$('optEgo').checked = true;
$('optEgo').onchange = (e) => { egoOn = e.target.checked; if (!egoOn) { stimAlias('worldL', 'eyeL', 0); stimAlias('worldR', 'eyeR', 0); } };
$('optPlastic').onchange = (e) => worker.postMessage({ type: 'plasticity', params: { enabled: e.target.checked } });
$('optVoice').checked = true;
$('optVoice').onchange = (e) => (behavior.enabled.voice = e.target.checked);
$('resetLearn').onclick = () => worker.postMessage({ type: 'plasticity', resetWeights: true });
// brain worms: "my cabinet members" (engineered lesion, off by default)
$('optWorms').checked = false;
function setWorms(on) {
  $('optWorms').checked = on;
  worker.postMessage({ type: 'worms', rate: on ? 150 : 0 });
  neuromap.setWorms(on);
  if (on) sidebar.ticker('Brain worms: "they whisper secrets to me and tell me all kinds of crazy stuff"');
}
$('optWorms').onchange = (e) => setWorms(e.target.checked);
$('wormsHeal').onclick = () => worker.postMessage({ type: 'worms', heal: true });
$('ambience').oninput = (e) => { ambBase = +e.target.value; setAmbience(ambBase * (1 - 0.5 * (1 - sleepGate))); };
$('hearGain').oninput = (e) => (hearing.gain = +e.target.value);
$('sfxVol').oninput = (e) => audio.setVolume(+e.target.value * masterVol);
// master volume (viewport): scales the show's sounds and the music together
let masterVol = 0.8;
function applyMaster() { audio.setVolume(+$('sfxVol').value * masterVol); music.setMaster(masterVol); stageScreens?.setVolume?.(stageScreens.volume, masterVol); $('masterVolNum').textContent = Math.round(masterVol * 100); }
$('masterVol').oninput = (e) => { masterVol = +e.target.value; applyMaster(); };
applyMaster();
$('initiative').onchange = (e) => { mind.initiative = e.target.checked; if (!e.target.checked) mind.stopAll(); };

// ------------------------------------------------------------------ food, stagehand / heckler, fly instincts
const food = new Food(scene);
const npcs = new Npcs(scene, stage, { food, cultists, audio, onEvent: (t) => sidebar.ticker(t),
  throwFrom: (kind, p) => { if (allowed(THROW_SWITCH[kind])) projectiles?.throw(kind, p); } });
const instincts = new Instincts({
  food, stimRate, stimAlias, pulse, reinforce, audio,
  home: hostPos.clone(),                            // the starting mark on the stage: home, where he drifts back to
  onEvent: (type, item) => {
    const pan = leftOrRight();
    if (type === 'eatStart') sidebar.ticker(`Leno extends his "proboscis" to the ${item.kind}`);
    if (type === 'bite') {
      audio.sfx('splat', { pan, gain: 0.25 }); if (Math.random() < 0.3) audio.mutter('hmm', { pan, gain: 0.5 });
      if (item.rotten) pulse('eclairBitter', 'tomato', 60, 0.5);          // it has gone off: bitter receptors too
    }
    if (type === 'ate') {
      sidebar.ticker(item.kind === 'poop' ? (host === flyHost ? 'Fly-Leno happily slurps up the goose droppings' : 'Leno eats the goose droppings') : `Leno finished the ${item.kind}`);
      audience.react(item.kind === 'poop' ? 'eatPoop' : item.kind === 'mushroom' ? 'powerUp' : 'eat');
      wellbeing.ate(item.kind);
      if (item.kind === 'mushroom') {
        // power-up: a big, long dopamine reward
        reinforce(1, 3.5); showSfx.sting('powerup', { gain: 0.6 }); crowdDo('cheer', 1);
        glitch.start(5); showSfx.sting('glitch', { gain: 0.5 });                  // the world corrupts like a bad NES cartridge
        sidebar.ticker('Leno eats the mushroom: POWER UP!');
      }
      if (item.rotten) {
        // "Oh, excuse me, it's the rotten eclair again": drive the pharyngeal motor neurons; the model's own
        // retch/vomit readout (js/behavior.js) takes it from there
        behavior.nausea = Math.max(behavior.nausea, 0.7);
        setTimeout(() => { pulse('eclairRetch', 'retchDrive', 45, 2.5); cue("Oh, excuse me, it's the rotten éclair again."); }, 2500);
        reinforce(-0.4, 1.5);
      } else if (Math.random() < 0.45) setTimeout(() => { audio.sfx('burp', { pan: leftOrRight() }); audience.react('burp'); }, 900);
    }
  },
});
// ------------------------------------------------------------------ stage screens: cams / YouTube / green screen
stageScreens = new StageScreens({
  renderer, scene, camera, stage, viewport: $('viewport'), liveCams, hearing, stimAlias,
  getHost: () => host,
  onChange: (mode) => {
    document.querySelectorAll('#screenModes button').forEach((b) => b.classList.toggle('on', b.dataset.screen === mode));
    setTimeout(() => ($('screenTitle').textContent = mode === 'video' ? (stageScreens.title() || '…') : mode === 'green' ? 'lime green screen' : 'live Leno cams'), 800);
  },
});
if (stageScreens.available) {
  stageScreens.resize(canvas.clientWidth, canvas.clientHeight);
  hearing.screenVideo = () => (stageScreens.mode === 'video' && stageScreens.player?.getPlayerState?.() === 1 ? (stageScreens.volume * stageScreens.master) / 100 : 0);
  document.querySelectorAll('#screenModes button').forEach((b) => (b.onclick = () => {
    const id = parseYouTubeId($('screenUrl').value);
    stageScreens.setMode(b.dataset.screen, b.dataset.screen === 'video' ? id : undefined);
  }));
  $('screenPlay').onclick = () => {
    const id = parseYouTubeId($('screenUrl').value);
    if (!id) { $('screenTitle').textContent = 'not a YouTube link'; return; }
    stageScreens.setMode('video', id);
  };
  $('screenVol').oninput = (e) => stageScreens.setVolume(+e.target.value, masterVol);
} else {
  $('screenModes').hidden = true;
  $('screenTitle').textContent = 'screen modes need the original stage';
}

// ------------------------------------------------------------------ eggs & hatchlings
const brood = new Brood({
  scene, stage, lenoScene: lenoPristine, audio,
  onEvent: (type) => {
    if (type === 'lay') { sidebar.ticker('Leno lays an egg!'); audience.react('lay'); }
    if (type === 'hatch') { sidebar.ticker('An egg hatches!'); audience.react('hatch'); }
  },
});
const entityCols = physHost ? new EntityColliders(physHost.RAPIER, physHost.world) : null;
const goose = new Goose({
  scene, stage, food, audio,
  onEvent: (type) => {
    if (type === 'enter') { sidebar.ticker('A goose wanders onto the stage…'); audience.react('goose'); }
    if (type === 'leave') sidebar.ticker('The goose waddles off');
  },
});
// ------------------------------------------------------------------ the Grey Leno Show: segments, guests, props
const showSfx = new ShowSfx(audio);
var showReady = false;              // (var: the autopilot callback can run before the show exists)
const CROWD_VAL = { cheer: 1, laugh: 0.7, applause: 1, boo: -1, gasp: -0.5 };
function crowdDo(kind, intensity = 1, force = false) {
  if (audienceAway || (force ? kind === 'boo' && switches.blocked('boos') : !audience.allowKind(kind))) return;
  // scripted crowd moments (not contingent on what Leno does): heard by the fly, and a dopamine signal
  const d = audio.crowd(kind, { gain: 0.5 + 0.5 * intensity });
  cultists.react(kind, intensity);
  Promise.resolve(d).then((x) => reinforce(0.6 * CROWD_VAL[kind] * intensity, Math.max(0.6, Math.min(3, x || 1.5))));
}
let cueTimer = null;
function cue(text) {
  // The host's scripted lines are not shown: the fly brain does the talking. (The segments' events still happen.)
  // const el = $('cue');
  // el.textContent = text; el.classList.add('on');
  // clearTimeout(cueTimer); cueTimer = setTimeout(() => el.classList.remove('on'), 5200);
  // sidebar.ticker(`Cue card: "${text}"`);
}
function pushHost(v) {
  if (host === flyHost) { flyHost.applyImpulse('pelvis', v); return; }
  if (!host.rag) return;
  host.rag.applyImpulse('pelvis', v);
  loosenHost(v.length());
}
/** a knock of `impulse` N·s: the puppet strings go slack for a moment so he can actually be knocked over */
function loosenHost(impulse) {
  if (host === flyHost || !host.loosen || impulse < 30) return;
  host.loosen(Math.min(0.95, 0.35 + impulse / 350), 0.4 + Math.min(1.2, impulse / 400));
}
function backflip() {
  if (host === flyHost) { flyHost.applyImpulse('pelvis', new THREE.Vector3(0, 520, 0)); return; }
  if (!host.rag) return;
  const axis = host.forward().cross(new THREE.Vector3(0, 1, 0));        // head goes back
  host.rag.applyImpulse('pelvis', new THREE.Vector3(0, 700, 0)); host.loosen?.(0.9, 1.2);
  host.rag.applyTorqueImpulse('chest', axis.clone().multiplyScalar(28));
  host.rag.applyTorqueImpulse('pelvis', axis.clone().multiplyScalar(22));
}
const show = new Show({
  scene, stage, audio, sfx: showSfx, screens: stageScreens?.available ? stageScreens : null,
  getHost: () => host, isFly: () => host === flyHost,
  hostPos: () => hostAt().clone(), hostHead: () => (host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0))).clone(),
  impulse: pushHost, backflip, stimAlias, pulse, reinforce,
  setStim: (k, on) => sidebar.setAuto(k, on),
  crowd: crowdDo, react: (act) => audience.react(act), ticker: (t) => sidebar.ticker(t), cue,
  motor: () => lastMotor?.command, duckMusic: (f) => music.setMaster(masterVol * f),
  voice: () => behavior.voiceEMA, mouthOpen: () => (behavior.eating ? 1 : mouth),
  deliverSnack: (kind) => { if (npcs.busy) return false; npcs.deliverSnack(getLeno, kind); return true; },
  onChange: () => updateShowUI(),
  allowed, said: () => behavior.said || 0, transcript: () => behavior.transcript,
  happen: (kind) => showPrize(kind),
  gooseVisit: () => { if (goose.active || !allowed('goose')) return false; goose.spawn(); return true; },
  gooseHead: () => goose.headPos(),
  wave: (laps) => cultists.wave(laps),
  dim: (x) => (dimTarget = x),
  lullaby: (on) => (sleep.lullaby = on),
  asleep: () => sleep.asleep,
  mic: (on) => audio.setMic(on),
  jonkler: () => jonkler,
});
// the Jonkler: nothing leaves his toy gun but a BANG! flag, and yet each shot throws Leno twice as hard as the last
const jonkler = new Jonkler({
  npcs, sfx: showSfx, center: show.center, stageRadius: physHost?.stageRadius ?? 7.3, getLeno, ticker: (t) => sidebar.ticker(t),
  onBang: (shot, from) => {
    const dir = hostAt().clone().sub(from).setY(0); if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1); dir.normalize();
    const mag = 320 * Math.pow(2, shot);                 // 320, 640, 1280 N·s
    launchHost(dir.multiplyScalar(mag).add(new THREE.Vector3(0, mag * 0.35, 0)));
    lastPieHit = performance.now();                      // (a slapstick throw: landing from it isn't an injury)
    pulse('bangHit', 'ambientTouch', 90, 0.5); pulse('bangLoom', 'heckler', 200, 0.3);
    audience.react('bang');
    sidebar.ticker(shot ? `BANG! (${2 ** shot}× harder)` : 'BANG!');
  },
  onLaugh: () => { if (Math.random() < 0.6) crowdDo('laugh', 0.7); },
});
/** throw him bodily: the same velocity change for every part of the ragdoll (a huge shove on one part would tear it) */
function launchHost(v) {
  if (host === flyHost) { flyHost.applyImpulse('thorax', v); return; }
  if (!host.rag) return;
  const bodies = Object.values(host.rag.bodies), M = bodies.reduce((a, b) => a + b.mass(), 0);
  for (const b of bodies) { const k = b.mass() / M; b.applyImpulse({ x: v.x * k, y: v.y * k, z: v.z * k }, true); }
  host.loosen?.(0.95, 1.6);
}
// the wheel's prizes (and anything else a segment hands out)
function showPrize(kind) {
  if (kind === 'sugar') return happenings.sugarThrow(6);
  if (kind === 'roses') return happenings.storm('rose', 12);
  if (kind === 'ovation') return standingOvation(9);
  if (kind === 'mushroom') return happenings.mushroom.start();
  if (kind === 'storm') return happenings.storm('mixed', 14);
  if (kind === 'tomatoStorm') return happenings.storm('tomato', 12 + ((Math.random() * 8) | 0));
  if (kind === 'pipeStorm') return happenings.storm('pipe', 6 + ((Math.random() * 5) | 0));
  if (kind === 'throws') {                               // a few booing people throw something
    for (let k = 0, n = 2 + ((Math.random() * 3) | 0); k < n; k++) setTimeout(() => throwThing(Math.random() < 0.7 ? 'tomato' : 'pipe'), 300 + k * (300 + Math.random() * 500));
    return true;
  }
}
let dimTarget = 1, dimLevel = 1;                    // the lullaby dims the studio lights (smoothly)
for (const [k, v] of Object.entries(SEGMENTS)) switches.define('seg:' + k, v.title, !!v.harmful);
function updateShowUI() {
  const cur = show.cur?.key;
  $('onair').textContent = cur ? `● ON AIR · episode ${show.episode} · ${SEGMENTS[cur].title}` : show.enabled ? `● ON AIR · episode ${Math.max(1, show.episode)}` : '';
  $('rundown').innerHTML = show.rundown.map((k, i) => `<li class="${k === cur ? 'now' : i < show.idx ? 'done' : ''}">${SEGMENTS[k].title}</li>`).join('');
}
$('segments').innerHTML = Object.entries(SEGMENTS).map(([k, v]) => `<button class="mini" data-seg="${k}">${v.title.replace(/"/g, '')}</button>`).join('');
$('segments').querySelectorAll('button').forEach((b) => (b.onclick = () => { if (!switches.blocked('seg:' + b.dataset.seg)) show.run(b.dataset.seg); }));
$('optRundown').checked = true;
function syncShowEnabled() { show.enabled = director.enabled && $('optRundown').checked; updateShowUI(); }
$('optRundown').onchange = syncShowEnabled;
showReady = true;
syncShowEnabled();

// ------------------------------------------------------------------ predators: spider-Leno, the swatter glove
const chestOf = () => {
  if (host === flyHost) return flyHost.root.position.clone().add(new THREE.Vector3(0, 0.95, 0));
  const b = host.rag?.bodies.chest;
  if (b) { const t = b.translation(); return new THREE.Vector3(t.x, t.y, t.z); }
  return hostAt().clone().add(new THREE.Vector3(0, 1.6, 0));
};
const velOf = () => {
  if (host === flyHost) return flyHost.vel.clone().add(flyHost.forward().multiplyScalar(flyHost.speed || 0));
  const b = host.rag?.bodies.chest;
  if (b) { const v = b.linvel(); return new THREE.Vector3(v.x, v.y, v.z); }
  return new THREE.Vector3();
};
/** a predator holds him at p (a spring on the chest; Fly-Leno is dragged by the thorax) or lets go (null) */
function holdHost(p) {
  if (host === flyHost) { flyHost.hold(p); return; }
  const b = host.rag?.bodies.chest;
  if (!b || !p) return;
  host.heldUntil = performance.now() + 300;          // dangling in a grip isn't a fall
  host.loosen?.(0.85, 0.3);
  const dt = 1 / 60, t = b.translation(), v = b.linvel(), m = 81;
  const f = new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z).multiplyScalar(30).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(8));
  f.multiplyScalar(0.5 * m * dt).add(new THREE.Vector3(0, m * 9.81 * dt, 0));
  b.applyImpulse({ x: f.x, y: f.y, z: f.z }, true);
}
let convulseT = 0, carShoveT = 0, contactT = 0;
const ceiling = stage.root.getObjectByName('Ceiling');
const predators = new Predators({
  scene, sfx: showSfx,
  hostHead: () => (host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0))).clone(),
  hostChest: chestOf, hostVel: velOf, isFly: () => host === flyHost,
  ceilY: ceiling ? new THREE.Box3().setFromObject(ceiling).min.y - 0.4 : hostPos.y + 16,
  knock: (v) => pushHost(v), hold: holdHost, convulse: (s) => (convulseT = s),
  pulse, reinforce, crowd: crowdDo, react: (act) => audience.react(act), ticker: (t) => sidebar.ticker(t),
  allowed,
});

// ------------------------------------------------------------------ happenings: Rapture, rain cloud, mushroom, rig, aliens
/** a standing ovation: everyone up, sustained applause and cheers, a long reward */
function standingOvation(dur = 9) {
  if (audienceAway) return false;
  cultists.ovation = dur;
  sidebar.ticker('A standing ovation!');
  for (let t = 0; t < dur - 1; t += 2.2) setTimeout(() => { if (!audienceAway) { audio.crowd('applause', { gain: 1 }); if (Math.random() < 0.6) audio.crowd('cheer', { gain: 0.8 }); } }, t * 1000);
  reinforce(0.8, Math.min(dur, 8));
  return true;
}
const groundRay = new THREE.Raycaster();
function groundY(p) {
  groundRay.set(new THREE.Vector3(p.x, p.y + 3, p.z), new THREE.Vector3(0, -1, 0)); groundRay.far = 40;
  const hit = groundRay.intersectObjects(stage.ground, false)[0];
  return hit ? hit.point.y : null;
}
const panOf = (p) => Math.max(-1, Math.min(1, p.clone().project(camera).x));
const clownCar = new ClownCar({
  scene, sfx: showSfx, npcs, center: show.center, stageRadius: physHost?.stageRadius ?? 7.3, groundAt: groundY,
  hostPos: () => hostAt().clone(), ticker: (t) => sidebar.ticker(t), crowd: crowdDo, pan: panOf,
  throwPie: (hand) => { if (!switches.blocked('clowns')) projectiles?.throw('pie', hand); },
});
const happenings = new Happenings({
  scene, sfx: showSfx, cultists, food, center: show.center, stageRadius: physHost?.stageRadius ?? 7.3,
  ceilY: ceiling ? new THREE.Box3().setFromObject(ceiling).min.y - 0.4 : hostPos.y + 16,
  groundAt: groundY, hostPos: () => hostAt().clone(),
  hostHead: () => (host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0))).clone(),
  shins: () => {
    if (host === flyHost) return [flyHost.root.position.clone().add(new THREE.Vector3(0, 0.3, 0))];
    if (host.rag?.bodies.calf_l) return ['calf_l', 'calf_r'].map((n) => { const t = host.rag.bodies[n].translation(); return new THREE.Vector3(t.x, t.y, t.z); });
    return [hostAt().clone().add(new THREE.Vector3(0, 0.4, 0))];
  },
  kick: (i, dir) => {
    // a kick in the shins: knocks the leg (and him) around
    if (host === flyHost) flyHost.applyImpulse('thorax', dir.clone().multiplyScalar(110).add(new THREE.Vector3(0, 60, 0)));
    else if (host.rag) {
      // the leg is swept, and the whole body gets shoved and popped up a little
      host.rag.applyImpulse(i ? 'calf_r' : 'calf_l', dir.clone().multiplyScalar(90));
      host.rag.applyImpulse('pelvis', dir.clone().setY(0).multiplyScalar(110).add(new THREE.Vector3(0, 70, 0)));
      host.rag.applyImpulse('chest', dir.clone().setY(0).multiplyScalar(60));
      loosenHost(160);
    }
    pulse('alienKick', 'ambientTouch', 60, 0.3); reinforce(-0.15, 0.4); audience.react('alienKick');
  },
  dropRig: (kind, p) => projectiles?.drop(kind, p),
  playSfx: (file, opts) => { if (audio.ctx) audio.playClip({ file }, opts); },
  pan: panOf, setCrowdChance: (x) => (audience.chance = x),
  setAudienceAway: (v) => { audienceAway = v; audience.away = v; },
  audienceAway: () => audienceAway,
  throwItem: (kind) => throwThing(kind, true),        // (the storms check their own switches)
  ovation: (dur) => standingOvation(dur),
  stimAlias, pulse, reinforce, ticker: (t) => sidebar.ticker(t),
  allowed, blocked: (k) => switches.blocked(k), startClowns: () => clownCar.start(), clownsActive: () => clownCar.present,
  // how much he needs a kind gesture from the seats: hungry -> sugar; miserable or stressed -> a rose
  needs: () => ({ hunger: instincts.hunger, low: Math.max(0, Math.min(1, (0.5 - wellbeing.cheer) * 2 + wellbeing.stress * 0.6)) }),
});

goose.gate = () => { if (allowed('goose')) return true; goose.nextT = 60; return false; };

// ------------------------------------------------------------------ a button for every event (Tonight's show panel)
// Started by hand, an event happens even if its switch is off; Peaceful Mode greys out the harmful ones.
const EVENT_BUTTONS = [
  ['Goose', 'goose', () => goose.spawn()],
  ['Spider-Leno', 'spider', () => predators.dropSpider()],
  ['Swatter glove', 'swatter', () => predators.sendSwatter(false)],
  ['Electric racket', 'racket', () => predators.sendSwatter(true)],
  ['Duendes', 'aliens', () => happenings.aliens.start()],
  ['Clown car', 'clowns', () => clownCar.start()],
  ['The Rapture', 'rapture', () => happenings.rapture.start()],
  ['Rain cloud', 'rain', () => happenings.rain.start()],
  ['Mushroom', 'mushroom', () => happenings.mushroom.start()],
  ['Falling rig', 'rig', () => happenings.rigFall()],
  ['Tomato storm', 'tomatoes', () => happenings.storm('tomato', undefined, undefined, true)],
  ['Pipe storm', 'pipes', () => happenings.storm('pipe', 8 + ((Math.random() * 6) | 0), undefined, true)],
  ['Tomato & pipe storm', 'storms', () => happenings.storm('mixed', undefined, undefined, true)],
  ['Rose storm', 'roseStorms', () => happenings.storm('rose', 14, undefined, true)],
  ['Standing ovation', 'ovations', () => standingOvation(9)],
  ['Sugar shower', 'sugar', () => happenings.sugarThrow(5)],
  ['Heckler', 'hecklers', () => { if (npcs.busy || audienceAway) sidebar.ticker('Someone is already on stage'); else npcs.heckle(getLeno); }],
  ['Stagehand snack', 'snacks', () => { if (npcs.busy) sidebar.ticker('Someone is already on stage'); else npcs.deliverSnack(getLeno, 'sugar'); }],
  ['Applause', 'cheers', () => crowdDo('applause', 1, true)],
  ['Cheers', 'cheers', () => crowdDo('cheer', 1, true)],
  ['Laughter', 'cheers', () => crowdDo('laugh', 1, true)],
  ['Gasp', 'gasps', () => crowdDo('gasp', 1, true)],
  ['Boos', 'boos', () => crowdDo('boo', 1, true)],
];
$('segments').insertAdjacentHTML('beforeend', `<div class="seg-head">Events</div>` +
  EVENT_BUTTONS.map(([label, sw], i) => `<button class="mini" data-evbtn="${i}" data-sw="${sw}">${label}</button>`).join(''));
$('segments').querySelectorAll('button[data-evbtn]').forEach((b) => (b.onclick = () => { if (!switches.blocked(b.dataset.sw)) EVENT_BUTTONS[+b.dataset.evbtn][2](); }));

// ------------------------------------------------------------------ event switches, Peaceful Mode
buildEventsPanel($('events'), switches, [['Show segments', Object.entries(SEGMENTS).map(([k, v]) => ['seg:' + k, v.title.replace(/"/g, ''), !!v.harmful])]]);
const AVERSIVE_STIMS = ['heckler', 'tomato', 'stink'];         // "Show events" chips that punish or frighten the fly
let wasPeaceful = null;
function applySwitches() {
  const P = switches.peaceful;
  show.frog.tongueOn = allowed('frogTongue');
  show.car.gentle = !allowed('carBump');
  show.gentle = P;
  // the manual buttons for harmful things are greyed out in Peaceful Mode
  for (const [id, sw] of [['throwTomato', 'tomatoes'], ['throwPipe', 'pipes']]) { const b = $(id); b.disabled = switches.blocked(sw); b.classList.toggle('grayed', b.disabled); }
  document.querySelectorAll('#segments button').forEach((b) => { b.disabled = switches.blocked(b.dataset.seg ? 'seg:' + b.dataset.seg : b.dataset.sw); b.classList.toggle('grayed', b.disabled); });
  for (const k of AVERSIVE_STIMS) {
    const el = sidebar.stimEls[k]; if (!el) continue;
    el.btn.disabled = P; el.btn.classList.toggle('grayed', P);
    if (P && sidebar.manual.has(k)) { sidebar.manual.delete(k); sidebar.refreshStim(k); }
  }
  $('optWorms').disabled = P; $('optWorms').closest('label')?.classList.toggle('grayed', P);
  if (P && wasPeaceful === false) {
    // switched on mid-show: the harmful things leave now
    predators.calmDown(); happenings.calmDown(); clownCar.leave(); jonkler.leave();
    if ($('optWorms').checked) setWorms(false);
    if (show.cur && SEGMENTS[show.cur.key]?.harmful) show.stopSegment();
    sidebar.ticker('🕊 Peaceful Mode: nothing harmful will happen');
  }
  wasPeaceful = P;
  updateShowUI();
}
switches.onChange(applySwitches);
applySwitches();

// compile the shaders of props that are hidden until their moment (the UFO, the Rapture's light column, the rain
// cloud) now, so their first appearance doesn't stall the show
show.ufo.g.visible = true; happenings.rapture.beam.visible = true;
happenings.rain.prewarm(renderer, camera);         // (compiles the whole scene, with the rain cloud's materials added)
show.ufo.g.visible = false; happenings.rapture.beam.visible = false;

$('eggChance').oninput = (e) => { brood.chance = +e.target.value / 100; $('eggChanceNum').textContent = e.target.value + '%'; };

// ?quiet: start with the show director (autopilot) and the fly's initiative off
if (params.has('quiet')) {
  director.enabled = false; $('autopilot').checked = false;
  mind.initiative = false; $('initiative').checked = false;
  goose.enabled = false;
  predators.enabled = false;
  happenings.enabled = false;
  syncShowEnabled();
}

for (const [id, k] of [['iSacc', 'saccades'], ['iBout', 'bouts'], ['iTaxis', 'taxis'], ['iDust', 'dust'], ['iHome', 'homing']]) $(id).onchange = (e) => (instincts.enabled[k] = e.target.checked);
$('iSleep').checked = true;
$('iSleep').onchange = (e) => (sleep.enabled = e.target.checked);

// ------------------------------------------------------------------ sleep
// "Zzz" letters float up from his head while he sleeps (a soft fade, nothing flashes)
const zzz = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.font = 'bold 52px Georgia, serif'; x.fillStyle = '#e8f0ff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('Z', 32, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const list = [0, 1, 2].map((i) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    s.visible = false; scene.add(s); return { s, ph: i / 3 };
  });
  let level = 0;
  return {
    update(dt, on, head) {
      level += ((on ? 1 : 0) - level) * Math.min(1, dt * 1.5);
      for (const z of list) {
        z.ph = (z.ph + dt * 0.28) % 1;
        z.s.visible = level > 0.02;
        if (!z.s.visible) continue;
        z.s.position.set(head.x + 0.25 + z.ph * 0.5, head.y + 0.35 + z.ph * 1.1, head.z);
        z.s.scale.setScalar(0.22 + z.ph * 0.3);
        z.s.material.opacity = level * Math.sin(z.ph * Math.PI) * 0.9;
      }
    },
  };
})();
let sleepGate = 1, ambBase = 1;                     // sensory gating while asleep (1 awake .. lower asleep)
sleep.onSleep = () => {
  mind.stopAll(); sidebar.ticker('Leno dozes off… zzz'); audience.react('doze');
};
sleep.onWake = (why) => sidebar.ticker(`Leno wakes up (${why})`);
let loomPrev = null;
/** everything that moves in the scene, as { key, p, r } (key: a stable object, so each is tracked on its own) */
function movers() {
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const out = [];
  for (const n of npcs.list) out.push({ key: n, p: n.headPos(), r: 0.6 });                               // stagehand, heckler
  if (goose.active) out.push({ key: goose.active, p: goose.active.g.position.clone().add(V(0, 0.5, 0)), r: 0.45 });
  const fr = show.frog.active; if (fr) out.push({ key: fr, p: fr.g.position.clone().add(V(0, 0.8, 0)), r: 0.75 });
  show.loomers().forEach((o, i) => out.push({ key: 'show' + i, ...o }));                               // tongue, car, UFO
  predators.loomers().forEach((o, i) => out.push({ key: 'pred' + i, ...o }));                          // spider, swatter
  const sp = predators.spider.active; if (sp) out.push({ key: sp, p: sp.root.position, r: 1.0 });
  const sw = predators.swatter.active; if (sw) out.push({ key: sw, p: sw.g.position, r: 0.5 });
  const cc = clownCar.active; if (cc) out.push({ key: cc, p: cc.g.position.clone().add(V(0, 0.8, 0)), r: 1.0 });
  for (const a of happenings.aliens.list) out.push({ key: a, p: a.p.clone().add(V(0, 0.6, 0)), r: 0.25 });
  const mu = happenings.mushroom.active; if (mu) out.push({ key: mu, p: mu.mesh.position, r: 0.45 });
  const rc = happenings.rain.active; if (rc) out.push({ key: rc, p: rc.g.position, r: 1.6 * rc.level });
  for (const b of show.balloons.list) out.push({ key: b, p: b.g.position, r: 0.35 });
  for (const y of brood.young) out.push({ key: y, p: y.kind === 'fly' ? y.body.root.position : y.body.root.position, r: 0.3 });
  for (const it of projectiles?.items ?? []) out.push({ key: it, p: it.mesh.position, r: it.kind === 'pipe' ? 0.35 : it.kind === 'tomato' || it.kind === 'rose' ? 0.12 : it.kind === 'sugar' ? 0.08 : it.kind === 'pie' ? 0.18 : 0.4 });
  return out;
}
let loomMap = new Map();
function looming(dt) {
  // LC4 looming detectors respond to the expansion rate of an approaching object's angular size (whatever it is)
  if (!dt) return;
  const head = host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0));
  let best = 0;
  const next = new Map();
  for (const o of movers()) {
    const th = 2 * Math.atan(o.r / Math.max(0.3, o.p.distanceTo(head)));
    const prev = loomMap.get(o.key);
    if (prev !== undefined) best = Math.max(best, (th - prev) / dt);
    next.set(o.key, th);
  }
  loomMap = next;
  stimAlias('loomNpc', 'heckler', Math.min(200, Math.max(0, best) * 900));
}

// Body controls (ragdoll)
if (physHost) {
  // (knocked down by a cream pie: a soft landing, no injury)
  physHost.onFall = () => { audience.react('fall'); sidebar.ticker('Leno collapses!'); pulse(performance.now() - lastPieHit < 3000 ? 'softFall' : 'fallTouch', 'ambientTouch', 80, 0.5); };
  const bc = $('bodyControls');
  bc.innerHTML = `<div class="status" style="margin-top:6px">Body: physics ragdoll, 46 muscles</div>
    <label class="rowlbl">puppet strings <input id="bSupport" type="range" min="0" max="1" step="0.05" value="${physHost.support}"></label>
    <label class="rowlbl">VNC assist <input id="bVnc" type="range" min="0" max="1" step="0.05" value="${physHost.vncWeight}"></label>
    <label class="rowlbl">direct DN → muscles <input id="bDirect" type="range" min="0" max="2" step="0.05" value="${physHost.directWeight}"></label>
    <label class="chk"><input type="checkbox" id="bStage"> keep on stage</label>`;
  $('bSupport').oninput = (e) => (physHost.support = +e.target.value);
  $('bVnc').oninput = (e) => (physHost.vncWeight = +e.target.value);
  $('bDirect').oninput = (e) => (physHost.directWeight = +e.target.value);
  $('bStage').onchange = (e) => { physHost.keepOnStage = e.target.checked; if (flyHost) flyHost.keepOnStage = e.target.checked; };
}

// ------------------------------------------------------------------ body form: Leno <-> Fly-Leno
async function setForm(form) {
  if (!physHost) { sidebar.ticker('Fly-Leno needs the physics body (not ?body=kinematic)'); return; }
  document.querySelectorAll('#form button').forEach((b) => b.classList.toggle('on', b.dataset.form === form));
  const from = host.state?.root?.clone() ?? hostAt().clone(), yaw = host.state?.heading ?? 0;
  if (form === 'fly') {
    if (host === flyHost) return;
    if (!flyHost) { sidebar.ticker('Growing wings…'); flyHost = (await new FlyLeno(scene).load()).attach(physHost, stage); }
    flyHost.keepOnStage = physHost.keepOnStage;
    for (const b of Object.values(physHost.rag.bodies)) b.setEnabled(false);
    for (const b of Object.values(flyHost.rag.bodies)) b.setEnabled(true);
    leno.root.visible = false; flyHost.setVisible(true);
    flyHost.place(from, yaw);
    host = flyHost;
    sidebar.ticker('Leno is now a fruit fly');
  } else {
    if (host === physHost) return;
    for (const b of Object.values(flyHost.rag.bodies)) b.setEnabled(false);
    for (const b of Object.values(physHost.rag.bodies)) b.setEnabled(true);
    flyHost.setVisible(false); leno.root.visible = true;
    physHost.rag.place(from, yaw);
    host = physHost;
    sidebar.ticker('Leno is himself again');
  }
  if (projectiles) projectiles.host = host;
}
document.querySelectorAll('#form button').forEach((b) => (b.onclick = () => setForm(b.dataset.form)));
if (params.get('form') === 'fly') setForm('fly');

// Mind panel: action values
const qEls = {};
for (const a of ACTIONS) {
  const el = document.createElement('div');
  el.className = 'qrow';
  el.innerHTML = `<div class="lbl">${a.label}</div><div class="bar"><i></i></div><div class="num">0</div>`;
  $('qvals').appendChild(el);
  qEls[a.key] = { el, bar: el.querySelector('i'), num: el.querySelector('.num') };
}
const biBar = (bar, num, v) => {
  const w = Math.min(1, Math.abs(v)) * 50;
  bar.style.left = (v >= 0 ? 50 : 50 - w) + '%'; bar.style.width = w + '%';
  bar.style.background = v >= 0 ? 'var(--good)' : 'var(--accent)';
  num.textContent = v.toFixed(2);
};
// state of mind / body / brain health rows (built once, updated a few times a second)
const wbEls = {};
function buildWellbeingUI() {
  const R = wellbeing.rows();
  for (const [group, id] of [['mind', 'wbMind'], ['body', 'wbBody'], ['brain', 'wbBrain']]) {
    wbEls[group] = R[group].map(([label, sub]) => {
      const el = document.createElement('div');
      el.className = 'meter wb';
      el.innerHTML = `<div class="lbl">${label}${sub ? `<small>${sub}</small>` : ''}</div><div class="bar"><i></i></div><div class="num">0</div>`;
      $(id).appendChild(el);
      return { bar: el.querySelector('i'), num: el.querySelector('.num') };
    });
  }
}
buildWellbeingUI();
let wbUiT = 0;
function updateWellbeingUI() {
  const now = performance.now();
  if (now - wbUiT < 250) return;
  wbUiT = now;
  const R = wellbeing.rows();
  for (const group of ['mind', 'body', 'brain']) R[group].forEach(([, , v, text, good], i) => {
    const e = wbEls[group][i];
    e.bar.style.width = (Math.max(0, Math.min(1, v)) * 100).toFixed(0) + '%';
    e.bar.className = good === true ? 'good' : good === false ? 'bad' : 'neutral';
    e.num.textContent = text;
  });
  $('conditionNow').textContent = wellbeing.summary();
}

function updateMindUI(t) {
  updateWellbeingUI();
  biBar($('daBar'), $('daNum'), mind.da);
  biBar($('moodBar'), $('moodNum'), mind.mood);
  $('broodNow').textContent = `${brood.eggs.length} egg${brood.eggs.length === 1 ? '' : 's'}, ${brood.young.length} hatchling${brood.young.length === 1 ? '' : 's'} (${brood.young.filter((y) => y.kind === 'fly').length} fly-form)`;
  $('instinctNow').textContent = instincts.status || (instincts.hunger > 0.25 ? `hungry (${(instincts.hunger * 100) | 0}%)` : 'content');
  $('mindNow').textContent = sleep.asleep ? 'asleep (zzz)' : mind.current ? mind.current.action : mind.initiative ? 'waiting…' : 'off';
  for (const a of ACTIONS) {
    const q = mind.Q[a.key], e = qEls[a.key];
    const w = Math.min(1, Math.abs(q) * 2) * 50;
    e.bar.style.left = (q >= 0 ? 50 : 50 - w) + '%'; e.bar.style.width = w + '%';
    e.bar.style.background = q >= 0 ? 'var(--good)' : 'var(--accent)';
    e.num.textContent = q.toFixed(2);
    e.el.classList.toggle('now', mind.current?.action === a.key);
  }
  $('learnNum').textContent = (t.plasticity / (t.winMs / 1000)).toFixed(2);
  $('learnEdges').textContent = t.plasticEdges?.toLocaleString() ?? '–';
  const v = behavior.voiceEMA;
  $('voiceBar').style.width = (v * 100).toFixed(0) + '%'; $('voiceNum').textContent = v.toFixed(2);
  $('transcript').textContent = behavior.transcript.slice(-16).join(' ') || '…';
}

// ------------------------------------------------------------------ worker messages
let lastMotor = null, runawayMs = 0, lastTickWall = 0;
const glitch = new NesGlitch($('viewport'), canvas);
const neuromap = new NeuroMap($('neuromap'), { maxPixelRatio: MOBILE ? 1.25 : 2 });
let wormsTotal = 0;
neuromap.load().catch((e) => console.warn('neural map unavailable', e));
$('mapRotate').checked = true; neuromap.autoRotate = true;            // rotates by default
$('mapRotate').onchange = (e) => (neuromap.autoRotate = e.target.checked);
worker.onmessage = ({ data }) => {
  switch (data.type) {
    case 'progress':
      setLoading(`Loading fly brain… ${(data.got / 1e6).toFixed(1)}${data.total ? ' / ' + (data.total / 1e6).toFixed(1) : ''} MB`);
      break;
    case 'status': setLoading(data.text); sidebar.status(data.text); break;
    case 'ready':
      sidebar.setReady(data);
      sidebar.status('running', 'ok');
      setAmbience(+$('ambience').value);
      worker.postMessage({ type: 'run' });
      setLoading('The fly is ready.');
      $('loading').querySelector('.spinner').hidden = true;
      $('startShow').hidden = false; $('startNote').hidden = false;
      break;
    case 'tick': {
      // Self-sustained runaway (the Shiu model can ignite it, e.g. Or56a): >250k spikes/s for 3 s -> reset.
      // (with adaptation the runaway state plateaus ~200-250k spikes/s; normal activity stays under ~100k)
      // count real (wall-clock) time: in runaway the sim slows to a crawl, so simulated time would take minutes
      const nowW = performance.now(), wallMs = Math.min(1000, nowW - (lastTickWall || nowW)); lastTickWall = nowW;
      runawayMs = data.spikesPerSec > 150e3 ? runawayMs + wallMs : 0;
      if (runawayMs > 2500) {
        runawayMs = 0; wellbeing.runaway();
        if (director.enabled) director.commercialBreak(() => worker.postMessage({ type: 'reset' }));
        else { worker.postMessage({ type: 'reset' }); sidebar.ticker('Runaway activity: brain reset'); }
      }
      window.flyleno.lastTick = data;
      if (data.spikes) neuromap.addSpikes(data.spikes);
      if (data.eaten?.length) neuromap.markEaten(data.eaten);
      if (data.eatenTotal !== wormsTotal) { wormsTotal = data.eatenTotal; $('wormsInfo').textContent = `${wormsTotal.toLocaleString()} cells eaten`; }
      lastMotor = decodeMotor(data.rates, data.winMs);
      if (host.setPools) host.setPools(data.muscles);
      host.setRates?.(data.rates);
      acts(lastMotor.command);
      behavior.tick(data);
      mind.tick(data);
      sidebar.update(data, lastMotor);
      updateMindUI(data);
      break;
    }
    case 'healed': neuromap.heal(); wormsTotal = 0; $('wormsInfo').textContent = '0 cells eaten'; sidebar.ticker('Brain worms evicted: all cells restored'); break;
    case 'error': sidebar.status('error: ' + data.message, 'warn'); setLoading('Brain error: ' + data.message); break;
  }
};
worker.postMessage({ type: 'init', base });

// ------------------------------------------------------------------ start (user gesture: audio + music + tab audio)
$('startShow').onclick = () => {
  audio.start();                   // creates the AudioContext synchronously, then loads the sound bank
  hearing.attachInternal();
  music.play();
  hearing.pipeTabAudio();          // asks to share this tab's audio ("in-world piping")
  $('loading').classList.add('done');
  $('audioSrc').textContent = '';
  setTimeout(() => { $('audioSrc').textContent = audio.usingBank ? 'sounds: Grey Leno / show sound bank' : audio.synth ? 'sounds: synthesised placeholders (?synth=1)' : 'sounds: sound bank not built yet (tools/audio): silent'; }, 1500);
  hearing.onChange();
};

// ------------------------------------------------------------------ about
$('aboutLink').onclick = (e) => {
  e.preventDefault();
  $('aboutBody').innerHTML = `
    <p>A whole-brain spiking model of the adult fruit fly (${meta.N.toLocaleString()} neurons,
    ${meta.E.toLocaleString()} connections, ${meta.synapses.toLocaleString()} synapses) runs live in your browser and
    puppeteers Grey Leno on a TUURD-Talk-style stage. Show events, the music and the crowd stimulate the fly's senses;
    its descending, mouthpart and pharyngeal neurons drive Leno's body and voice; audience reactions reach its
    dopaminergic neurons and shape what it learns and chooses.</p>
    <p><b>Brain model:</b> leaky integrate-and-fire network after Shiu et al. 2024, <i>Nature</i>
    (<a href="https://github.com/philshiu/Drosophila_brain_model">philshiu/Drosophila_brain_model</a>, MIT), with optional
    spike-frequency adaptation and dopamine-gated plasticity added here. Connectome FlyWire v783 (Dorkenwald et al. 2024;
    Schlegel et al. 2024). Stimulus/motor neuron IDs partly via
    <a href="https://github.com/erojasoficial-byte/fly-brain">erojasoficial-byte/fly-brain</a> (MIT).</p>
    <p><b>Engineered layers (not in the connectome):</b> the phoneme mapping of motor neurons, the action selector
    ("initiative"), the audience, and the stage-edge reflex.</p>
    <p><b>Stage:</b> an original procedural set inspired by the TUURD Talk show of <i>Nightmare Puppeteer</i>.
    Leno's voice bank is cut from Vinesauce's Grey Leno videos (<a href="https://www.youtube.com/watch?v=ki3ssj466E0" target="_blank" rel="noopener">The Grey Leno Show</a>,
    <a href="https://www.youtube.com/watch?v=w7lBVJwHABM" target="_blank" rel="noopener">Grey Leno announces his candidacy</a>), with thanks to Vinesauce.
    Crowd and effect sounds are cut from YouTube sound-effect uploads (sources listed in assets/audio/manifest.json).
    Rimshots: "Ba dum tss [Joke Rimshot]" by <a href="https://freesound.org/people/FREE_SOUND_ENTERTAINMENT/packs/31539/" target="_blank" rel="noopener">FREE_SOUND_ENTERTAINMENT</a>
    (Freesound, <a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>). Drum rolls:
    <a href="https://commons.wikimedia.org/wiki/File:Drum_Roll_Intro.ogg" target="_blank" rel="noopener">Drum Roll Intro</a> (Wikimedia Commons, CC0) and the
    <a href="https://commons.wikimedia.org/wiki/File:Drum_Roll_-_Concert_Band_-_United_States_Air_Force_Band.mp3" target="_blank" rel="noopener">United States Air Force Band</a> (public domain).</p>
    <p class="credit"><b>Grey Leno model:</b> ported by <b>huckleberrypie</b> (Nexus Mods: huckpie):
    <a href="https://www.nexusmods.com/deadasdisco/mods/917" target="_blank" rel="noopener">Grey Leno for Dead as Disco (Nexus Mods)</a>.
    Original character and model by Vinesauce. Used in accordance with the mod's terms of use.</p>
    <p><b>Music:</b> YouTube embed; the fly hears it through a capture of this tab's audio when you allow it.</p>`;
  $('about').showModal();
};

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let hearAcc = 0, hearEMA = 0;
// ------------------------------------------------------------------ pause / reset (whole show, not just the brain)
let paused = false;
let mouth = 0;
function setPaused(p) {
  paused = p;
  worker.postMessage({ type: p ? 'pause' : 'run' });
  sidebar.ticker(p ? 'Paused' : 'Resumed');
}
function resetShow() {
  director.stopAll(); mind.stopAll();
  for (const k of [...sidebar.manual]) { sidebar.manual.delete(k); sidebar.refreshStim(k); }
  for (const k of Object.keys(pulseTimers)) worker.postMessage({ type: 'stim', key: k, rate: 0 });
  for (const k of ['reward', 'punish']) stimRate(k, 0);
  worker.postMessage({ type: 'reset' });
  if (projectiles) { for (const it of [...projectiles.items]) projectiles.remove(it); for (const s of projectiles.splats) disposeObject(s.mesh); projectiles.splats.length = 0; }
  if (host === flyHost) flyHost.place(physHost.home, 0);
  else if (host.rag) { host.rag.place(host.home, 0); host.gesture = null; host.fallenFor = 0; host.getUp = 0; }
  else leno.place(stage.markers.host, stage.ground, stage.markers.stageCenter);
  mind.mood = 0; behavior.nausea = 0; behavior.transcript.length = 0;
  brood.clear(); goose.clear(); show.clear(); predators.clear(); happenings.clear(); clownCar.clear(); jonkler.clear(); convulseT = 0; cultists.ovation = 0;
  sleep.wake('show reset'); sleep.pressure = 0.15; dimTarget = 1; sleep.lullaby = false;
  food.clear(); for (const n of npcs.list) n.remove(); npcs.list.length = 0; cultists.hidden.clear(); instincts.hunger = 0.4;
  sidebar.ticker('Show reset');
}

renderer.setAnimationLoop(() => {
  const rawDt = Math.min(0.05, clock.getDelta());
  const dt = paused ? 0 : rawDt;
  if (!paused) {
  // sleep: dozes off when he's tired and safe; asleep, his own initiative rests (the show goes on around him)
  const heldNow = host === flyHost ? !!flyHost.heldAt : (host.heldUntil ?? 0) > performance.now();
  const knockedNow = host === flyHost ? flyHost.knockT > 0 : (host.slack ?? 0) > 0.3;
  sleep.update(dt, { energy: wellbeing.energy, fear: wellbeing.fear, loom: window.flyleno?.lastTick?.rates?.['s:heckler'] ?? 0,
    held: heldNow, eating: instincts.eating, knocked: knockedNow, fallen: !!host.state?.fallen, flying: host === flyHost && flyHost.flying });
  instincts.asleep = sleep.asleep; mind.suspended = sleep.asleep; behavior.asleep = sleep.asleep;
  director.update(dt);
  mind.update(dt);
  audience.update(dt);
  behavior.update(dt, { pan: leftOrRight() });
  if (lastMotor) {
    const adj = instincts.update(dt, host, lastMotor.command, window.flyleno?.lastTick?.rates);
    host.setMotor(adj.cmd);
    host.setPosture?.({ ...adj.posture, sleep: sleep.asleep ? 1 : 0 });
    behavior.eating = instincts.eating;
  }
  npcs.update(dt);
  director.hold = show.active;
  audience.hush = sleep.lullaby ? 0.3 : 1;                         // the audience keeps its voice down for the lullaby
  // sensory gating while asleep: eyes shut, hearing and touch turned down
  const gate = sleep.asleep ? 1 - sleep.depth : 1;
  if (Math.abs(gate - sleepGate) > 0.02 || (gate === 1 && sleepGate !== 1)) { sleepGate = gate; setAmbience(ambBase * (1 - 0.5 * (1 - gate))); }
  zzz.update(dt, sleep.asleep, host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0)));
  wellbeing.update({
    dt, arousal: mind.arousal, mood: mind.mood, cmd: lastMotor?.command, rates: window.flyleno?.lastTick?.rates,
    isFly: host === flyHost, flying: host === flyHost && flyHost.flying, fallen: !!host.state?.fallen,
    held: host === flyHost ? !!flyHost.heldAt : (host.heldUntil ?? 0) > performance.now(),
    knocked: host === flyHost ? flyHost.knockT > 0 : (host.slack ?? 0) > 0.3, glitch: glitch.active, eating: instincts.eating,
    hunger: instincts.hunger, nausea: behavior.nausea, homesick: Math.max(instincts.homesick, instincts.homeUrge),
    spikes: window.flyleno?.lastTick?.spikesPerSec ?? 0, eatenFrac: wormsTotal / meta.N,
    asleep: sleep.asleep, depth: sleep.depth, sleepiness: sleep.pressure,
  });
  show.update(dt);
  predators.update(dt, true);                        // random visits, like the goose
  if (host !== flyHost && show.car.present && host.rag && allowed('carBump')) {
    const hp = hostAt();
    for (const c of show.car.colliders()) if (hp.clone().setY(0).distanceTo(c.pos.clone().setY(0)) < c.radius + 0.5) { loosenHost(200); break; }
  }
  if (host === flyHost && show.car.present && allowed('carBump')) {
    carShoveT -= dt;
    const fp = flyHost.root.position;
    for (const c of show.car.colliders()) {
      const away = fp.clone().sub(c.pos).setY(0), d = away.length();
      if (d < c.radius + 0.6 && fp.y < c.pos.y + c.height + 0.5 && carShoveT <= 0) {
        carShoveT = 0.5;
        flyHost.applyImpulse('thorax', away.normalize().multiplyScalar(160 + 60 * show.car.active.speed).add(new THREE.Vector3(0, 90, 0)));
        break;
      }
    }
  }
  happenings.update(dt, true);
  clownCar.update(dt);
  if (convulseT > 0) {                               // after a zap: twitching
    convulseT -= dt;
    const r = () => (Math.random() - 0.5) * 2;
    if (host === flyHost) flyHost.vel.add(new THREE.Vector3(r(), 0, r()).multiplyScalar(0.8));
    else if (host.rag) { host.rag.applyImpulse('chest', new THREE.Vector3(r() * 40, r() * 25, r() * 40)); host.rag.applyImpulse('pelvis', new THREE.Vector3(r() * 30, 0, r() * 30)); host.loosen?.(0.7, 0.3); }
  }
  brood.update(dt, host);
  goose.update(dt, true);                            // visits at random, on its own schedule
  // moving entities are solid too (stagehand, heckler, goose, hatchlings)
  if (entityCols) {
    const ents = npcs.list.map((n, i) => ({ key: n, pos: n.fig.position, radius: 0.45, height: 2.5 }));
    if (goose.active) ents.push({ key: goose.active, pos: goose.active.g.position, radius: 0.35, height: 1.1 });
    ents.push(...show.colliders(), ...clownCar.colliders());
    for (const y of brood.young) ents.push({ key: y, pos: y.kind === 'fly' ? y.body.pos : y.body.root.position, radius: y.kind === 'fly' ? 0.3 : 0.22, height: y.kind === 'fly' ? 0.5 : 0.85 });
    entityCols.sync(ents);
    // contact: anything solid rubbing against him drives his mechanosensory neurons
    contactT -= dt;
    if (contactT <= 0) {
      const hp = hostAt();
      for (const e of ents) {
        if (Math.hypot(e.pos.x - hp.x, e.pos.z - hp.z) < e.radius + 0.5 && Math.abs(e.pos.y - hp.y) < e.height + 0.5) {
          contactT = 0.4; pulse('contactTouch', 'ambientTouch', 35, 0.35); break;
        }
      }
    }
  }
  looming(dt);
  host.update(dt);
  // lip-sync: mouth follows the loudness of Leno's own sounds (fast open, slower close); feeding opens it too
  {
    const target = Math.max(audio.mouthOpen(), behavior.eating ? 0.55 + 0.25 * Math.sin(clock.elapsedTime * 9) : 0);
    mouth += (target - mouth) * Math.min(1, dt * (target > mouth ? 30 : 12));
    (host.setMouth ? host : leno).setMouth(mouth);
  }
  projectiles?.update(dt);
  cultists.target = host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0));
  cultists.eye = camera.position;                    // levels of detail by distance from the viewer
  cultists.update(dt);
  fx.floorY = hostAt().y + 0.01;
  fx.update(dt);
  }
  stage.screens.update(clock.elapsedTime);
  // the fly's own eyesight: a few times a second, what its eyes see drives its photoreceptors
  if (!paused && egoOn) {
    egoT -= rawDt;
    if (egoT <= 0) {
      egoT = MOBILE ? 0.25 : 0.125;
      const E = eyePose();
      hideHead(true); ego.sample(renderer, scene, E.pos, E.quat); hideHead(false);
      stimAlias('worldL', 'eyeL', ego.rates.L * sleepGate); stimAlias('worldR', 'eyeR', ego.rates.R * sleepGate);   // (eyes shut asleep)
    }
  }
  if (stageScreens?.available) stageScreens.gain = (egoOn && stageScreens.mode !== 'video' ? 0 : 1) * sleepGate;   // (seen through the eyes already)
  if (stageScreens?.available) {
    if (stageScreens.greenGlow && stage.screens.glow) stage.screens.glow.color.set(0x33ff33);
    stageScreens.update(rawDt);
    const r = stageScreens.rates, eL = egoOn ? ego.rates.L : 0, eR = egoOn ? ego.rates.R : 0;
    $('eyeLBar').style.width = Math.min(100, (r.L + eL) / 0.9).toFixed(0) + '%'; $('eyeLNum').textContent = (r.L + eL).toFixed(0);
    $('eyeRBar').style.width = Math.min(100, (r.R + eR) / 0.9).toFixed(0) + '%'; $('eyeRNum').textContent = (r.R + eR).toFixed(0);
    $('visionNote').textContent = stageScreens.visionNote;
  }
  hearAcc += dt;
  if (hearAcc > 0.05) {
    hearAcc = 0;
    const h = hearing.update();
    const ear = 1 - 0.6 * (1 - sleepGate);                         // hearing is turned down asleep
    stimRate('hearLow', h.low * ear); stimRate('hearHigh', h.high * ear);
    // a sudden loud noise wakes him
    const loud = h.low + h.high;
    hearEMA += (loud - hearEMA) * 0.05;
    if (sleep.asleep && loud - hearEMA > 0.5 * hearing.maxRate) { sleep.disturbWhy = 'a loud noise'; sleep.jolt(0.12); }
    $('hearLowBar').style.width = (100 * h.low / hearing.maxRate).toFixed(0) + '%'; $('hearLowNum').textContent = h.low.toFixed(0);
    $('hearHighBar').style.width = (100 * h.high / hearing.maxRate).toFixed(0) + '%'; $('hearHighNum').textContent = h.high.toFixed(0);
  }
  if (eyeMode()) {
    // first person: ride the head (smoothed a little, so the ragdoll's wobble doesn't shake the view)
    const E = eyePose();
    if (!eyeS.init) { eyeS.pos.copy(E.pos); eyeS.quat.copy(E.quat); eyeS.init = true; }
    eyeS.pos.lerp(E.pos, 1 - Math.exp(-rawDt * 25));
    eyeS.quat.slerp(E.quat, 1 - Math.exp(-rawDt * 12));
    camera.position.copy(eyeS.pos);
    camera.quaternion.copy(eyeS.quat).multiply(CAM_FLIP);
    const fov = camMode === 'eyes' ? humanFov(camera.aspect) : 45;
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  } else if (tracking()) {
    const c = cams[camMode]();
    if (!camUser) {
      camera.position.lerp(c.pos, 1 - Math.exp(-rawDt * 3));
      controls.target.lerp(c.target, 1 - Math.exp(-rawDt * 5));
    } else {
      // keep the user's orbit: move the camera with the target, and in Close-up turn it with Leno
      const before = controls.target.clone();
      controls.target.lerp(c.target, 1 - Math.exp(-rawDt * 5));
      camera.position.add(controls.target.clone().sub(before));
      if (camMode === 'close') {
        const y = hostYaw(); let dy = y - camYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); camYaw = y;
        camera.position.sub(controls.target).applyAxisAngle(THREE.Object3D.DEFAULT_UP, dy).add(controls.target);
      }
    }
  }
  dimLevel += (dimTarget - dimLevel) * Math.min(1, rawDt * 0.6);
  renderer.toneMappingExposure = 0.85 * (0.25 + 0.75 * dimLevel);
  if (!eyeMode()) controls.update();
  for (const l of stageLODs) l.update(camera.position);
  propLOD.update(camera, rawDt);
  liveCams?.update(rawDt);
  if (camMode === 'flyeyes') { hideHead(true); flyEye.render(renderer, scene, eyeS.pos, eyeS.quat, camera.aspect); hideHead(false); }
  else if (camMode === 'eyes') { hideHead(true); renderer.render(scene, camera); hideHead(false); }
  else renderer.render(scene, camera);
  const gk = glitch.update(rawDt);
  stimAlias('glitchL', 'eyeL', 40 * gk);                // the fly sees the corrupted picture too
  stimAlias('glitchR', 'eyeR', 40 * gk);
  neuromap.render(rawDt);
});

window.flyleno = {
  scene, camera, controls, leno, stageScreens, brood, goose, show, showSfx, predators, happenings, stageLODs, propLOD, glitch, get host() { return host; },
  switches, sleep, wellbeing, clownCar, jonkler, setForm, stage, cultists, food, npcs, instincts, projectiles, liveCams, throwThing, worker, director, mind, audience, behavior, audio, music, hearing, fx, motorGains,
  get motor() { return lastMotor; },
};
