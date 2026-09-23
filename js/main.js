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
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

// YouTube embeds fail (error 150) on bare-IP origins such as 127.0.0.1, but work on localhost.
if (location.hostname === '127.0.0.1') { location.replace(location.href.replace('//127.0.0.1', '//localhost')); await new Promise(() => {}); }
const params = new URLSearchParams(location.search);
const LITE = params.has('lite');           // no stage point lights, 1x pixel ratio (slow GPUs / headless tests)
const STAGE = params.get('stage') || 'original';   // 'original' (procedural, default) | 'game' (exported GLB)
const BODY = params.get('body') || 'ragdoll';       // 'ragdoll' (physics, fly drives the muscles) | 'kinematic'
const $ = (id) => document.getElementById(id);
const loadingText = $('loadingText');
const setLoading = (t) => { loadingText.textContent = t; console.log('[flyleno]', t); };

// ------------------------------------------------------------------ renderer / scene
const canvas = $('three');
// alpha: the stage's YouTube screen is an iframe *behind* the canvas, shown through a transparent hole
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
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
// Follow / Close-up keep tracking Leno when you orbit or zoom: the camera then rides along rigidly with its target
// (and turns with Leno's heading in Close-up) instead of snapping back. Clicking the mode again resets the view.
let camUser = false, camYaw = 0;
const hostYaw = () => { const f = host.forward(); return Math.atan2(f.x, f.z); };
const tracking = () => camMode === 'follow' || camMode === 'close';
function setCam(mode) {
  camMode = mode; camUser = false;
  document.querySelectorAll('#cams button').forEach((b) => b.classList.toggle('on', b.dataset.cam === mode));
  if (cams[mode]) { const c = cams[mode](); camera.position.copy(c.pos); controls.target.copy(c.target); }
}
document.querySelectorAll('#cams button').forEach((b) => (b.onclick = () => setCam(b.dataset.cam)));
controls.addEventListener('start', () => {
  if (tracking()) { camUser = true; camYaw = hostYaw(); }
  else if (camMode !== 'free') setCam('free');
});
$('showMarkers').onchange = (e) => (stage.markerGroup.visible = e.target.checked);
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
  const k = valence >= 0 ? 'reward' : 'punish';
  stimRate(k, 40 * Math.min(1, Math.abs(valence)));
  clearTimeout(reinforceTimers[k]);
  reinforceTimers[k] = setTimeout(() => stimRate(k, 0), seconds * 1000);
}
// short stimulus pulse on a named group under its own key (so it does not clash with UI-managed stimuli)
const pulseTimers = {};
function pulse(alias, group, rate, seconds) {
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
  snack: () => { if (npcs.busy) return false; npcs.deliverSnack(getLeno, Math.random() < 0.25 ? 'eclair' : 'sugar'); return true; },
  heckler: () => { if (npcs.busy || audienceAway) return false; npcs.heckle(getLeno); return true; },
});
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
      alienKick: 'shin kick', rigHit: 'falling rig', powerUp: 'power-up', roseHit: 'rose' }[e.act] || e.act;
    sidebar.ticker(`Audience ${verb} at the ${what}`);
    cultists.react(e.kind, e.intensity);
    // an unhappy crowd throws things
    if (e.kind === 'boo' && Math.random() < 0.35) setTimeout(() => throwThing(Math.random() < 0.15 ? 'pipe' : 'tomato'), 400 + Math.random() * 900);
  },
});

// ------------------------------------------------------------------ projectiles (tomatoes, pipes)
const projectiles = host !== leno ? new Projectiles(scene, host, {
  onApproach: () => pulse('loom', 'heckler', 200, 0.35),
  onSplat: (p, onLeno, rest) => { fx.splash(p); if (!onLeno) food.addTomato(rest ?? p); },              // looming object -> LC4 looming detectors
  onImpact: (it, { hitLeno, speed }) => {
    const p = it.mesh.position.clone().project(camera), pan = Math.max(-1, Math.min(1, p.x));
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
if (projectiles) projectiles.ground = stage.ground;          // where missed tomatoes end up
let audienceAway = false;                         // the seats are empty (after the Rapture): no reactions, no throws
function throwThing(kind) {
  if (!projectiles) { sidebar.ticker('Throwing needs the physics body (not ?body=kinematic)'); return; }
  if (audienceAway) { sidebar.ticker('Nobody is in the seats to throw anything'); return; }
  projectiles.throw(kind, cultists.standRandom());
}
$('throwTomato').onclick = () => throwThing('tomato');
$('throwPipe').onclick = () => throwThing('pipe');
$('throwRose').onclick = () => throwThing('rose');
const behavior = new Behavior(meta, audio, {
  onEvent: (type, d) => {
    if (type === 'vomit') { host.trigger('vomit'); setTimeout(() => fx.vomit(() => host.mouth(), () => host.headDown(), 1.1), 500); }
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
$('optPlastic').onchange = (e) => worker.postMessage({ type: 'plasticity', params: { enabled: e.target.checked } });
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
$('ambience').oninput = (e) => setAmbience(+e.target.value);
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
const npcs = new Npcs(scene, stage, { food, cultists, audio, onEvent: (t) => sidebar.ticker(t), throwFrom: (kind, p) => projectiles?.throw(kind, p) });
const instincts = new Instincts({
  food, stimRate, pulse, reinforce, audio,
  onEvent: (type, item) => {
    const pan = leftOrRight();
    if (type === 'eatStart') sidebar.ticker(`Leno extends his "proboscis" to the ${item.kind}`);
    if (type === 'bite') {
      audio.sfx('splat', { pan, gain: 0.25 }); if (Math.random() < 0.3) audio.mutter('hmm', { pan, gain: 0.5 });
      if (item.rotten) pulse('eclairBitter', 'tomato', 60, 0.5);          // it has gone off: bitter receptors too
    }
    if (type === 'ate') {
      sidebar.ticker(item.kind === 'poop' ? 'Fly-Leno happily slurps up the goose droppings' : `Leno finished the ${item.kind}`);
      audience.react(item.kind === 'poop' ? 'eatPoop' : item.kind === 'mushroom' ? 'powerUp' : 'eat');
      if (item.kind === 'mushroom') {
        // power-up: a big, long dopamine reward
        reinforce(1, 3.5); showSfx.sting('powerup', { gain: 0.6 }); crowdDo('cheer', 1);
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
function crowdDo(kind, intensity = 1) {
  if (audienceAway) return;
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
  if (host === flyHost) flyHost.applyImpulse('pelvis', v);
  else host.rag?.applyImpulse('pelvis', v);
}
function backflip() {
  if (host === flyHost) { flyHost.applyImpulse('pelvis', new THREE.Vector3(0, 520, 0)); return; }
  if (!host.rag) return;
  const axis = host.forward().cross(new THREE.Vector3(0, 1, 0));        // head goes back
  host.rag.applyImpulse('pelvis', new THREE.Vector3(0, 700, 0));
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
});
function updateShowUI() {
  const cur = show.cur?.key;
  $('onair').textContent = cur ? `● ON AIR · episode ${show.episode} · ${SEGMENTS[cur].title}` : show.enabled ? `● ON AIR · episode ${Math.max(1, show.episode)}` : '';
  $('rundown').innerHTML = show.rundown.map((k, i) => `<li class="${k === cur ? 'now' : i < show.idx ? 'done' : ''}">${SEGMENTS[k].title}</li>`).join('');
}
$('segments').innerHTML = Object.entries(SEGMENTS).map(([k, v]) => `<button class="mini" data-seg="${k}">${v.title.replace(/"/g, '')}</button>`).join('');
$('segments').querySelectorAll('button').forEach((b) => (b.onclick = () => show.run(b.dataset.seg)));
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
  const dt = 1 / 60, t = b.translation(), v = b.linvel(), m = 81;
  const f = new THREE.Vector3(p.x - t.x, p.y - t.y, p.z - t.z).multiplyScalar(30).sub(new THREE.Vector3(v.x, v.y, v.z).multiplyScalar(8));
  f.multiplyScalar(0.5 * m * dt).add(new THREE.Vector3(0, m * 9.81 * dt, 0));
  b.applyImpulse({ x: f.x, y: f.y, z: f.z }, true);
}
let convulseT = 0;
const ceiling = stage.root.getObjectByName('Ceiling');
const predators = new Predators({
  scene, sfx: showSfx,
  hostHead: () => (host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0))).clone(),
  hostChest: chestOf, hostVel: velOf, isFly: () => host === flyHost,
  ceilY: ceiling ? new THREE.Box3().setFromObject(ceiling).min.y - 0.4 : hostPos.y + 16,
  knock: (v) => pushHost(v), hold: holdHost, convulse: (s) => (convulseT = s),
  pulse, reinforce, crowd: crowdDo, react: (act) => audience.react(act), ticker: (t) => sidebar.ticker(t),
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
    }
    pulse('alienKick', 'ambientTouch', 60, 0.3); reinforce(-0.15, 0.4); audience.react('alienKick');
  },
  dropRig: (kind, p) => projectiles?.drop(kind, p),
  playSfx: (file, opts) => { if (audio.ctx) audio.playClip({ file }, opts); },
  pan: panOf, setCrowdChance: (x) => (audience.chance = x),
  setAudienceAway: (v) => { audienceAway = v; audience.away = v; },
  audienceAway: () => audienceAway,
  throwItem: (kind) => throwThing(kind),
  ovation: (dur) => standingOvation(dur),
  stimAlias, pulse, reinforce, ticker: (t) => sidebar.ticker(t),
});

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

for (const [id, k] of [['iSacc', 'saccades'], ['iBout', 'bouts'], ['iTaxis', 'taxis'], ['iDust', 'dust']]) $(id).onchange = (e) => (instincts.enabled[k] = e.target.checked);
let loomPrev = null;
function looming(dt) {
  // LC4 looming detectors respond to the expansion rate of an approaching object's angular size
  if (!dt) return;
  const head = host.state?.headPos ?? hostAt().clone().add(new THREE.Vector3(0, 2.3, 0));
  let best = 0;
  const objs = [...npcs.approaching().map((p) => ({ p, r: 0.6 })), ...show.loomers(), ...predators.loomers()];
  const thetas = objs.map(({ p, r }) => 2 * Math.atan(r / Math.max(0.3, p.distanceTo(head))));
  if (loomPrev?.length === thetas.length) thetas.forEach((th, i) => (best = Math.max(best, (th - loomPrev[i]) / dt)));
  loomPrev = thetas;
  stimAlias('loomNpc', 'heckler', Math.min(200, Math.max(0, best) * 900));
}

// Body controls (ragdoll)
if (physHost) {
  physHost.onFall = () => { audience.react('fall'); sidebar.ticker('Leno collapses!'); };
  const bc = $('bodyControls');
  bc.innerHTML = `<div class="status" style="margin-top:6px">Body: physics ragdoll, 46 muscles</div>
    <label class="rowlbl">puppet strings (support) <input id="bSupport" type="range" min="0" max="1" step="0.05" value="${physHost.support}"></label>
    <label class="rowlbl">VNC assist (leg rhythms) <input id="bVnc" type="range" min="0" max="1" step="0.05" value="${physHost.vncWeight}"></label>
    <label class="rowlbl">direct DN → muscles <input id="bDirect" type="range" min="0" max="2" step="0.05" value="${physHost.directWeight}"></label>
    <label class="chk"><input type="checkbox" id="bStage"> keep Leno on the stage (edge reflex)</label>`;
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
function updateMindUI(t) {
  biBar($('daBar'), $('daNum'), mind.da);
  biBar($('moodBar'), $('moodNum'), mind.mood);
  $('broodNow').textContent = `${brood.eggs.length} egg${brood.eggs.length === 1 ? '' : 's'}, ${brood.young.length} hatchling${brood.young.length === 1 ? '' : 's'} (${brood.young.filter((y) => y.kind === 'fly').length} fly-form)`;
  $('instinctNow').textContent = instincts.status || (instincts.hunger > 0.25 ? `hungry (${(instincts.hunger * 100) | 0}%)` : 'content');
  $('mindNow').textContent = mind.current ? mind.current.action : mind.initiative ? 'waiting…' : 'off';
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
const neuromap = new NeuroMap($('neuromap'));
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
        runawayMs = 0;
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
    Leno's voice bank comes from Vinesauce videos and belongs to its authors; it is not distributed with this project.</p>
    <p class="credit"><b>Grey Leno model:</b> ported by <b>huckleberrypie</b> (Nexus Mods: huckpie):
    <a href="https://www.nexusmods.com/deadasdisco/mods/917" target="_blank" rel="noopener">Grey Leno for Dead as Disco (Nexus Mods)</a>.
    Original character and model by Vinesauce. Used in accordance with the mod's terms of use.</p>
    <p><b>Music:</b> YouTube embed; the fly hears it through a capture of this tab's audio when you allow it.</p>`;
  $('about').showModal();
};

// ------------------------------------------------------------------ loop
const clock = new THREE.Clock();
let hearAcc = 0;
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
  if (projectiles) { for (const it of [...projectiles.items]) projectiles.remove(it); for (const s of projectiles.splats) scene.remove(s.mesh); projectiles.splats.length = 0; }
  if (host === flyHost) flyHost.place(physHost.home, 0);
  else if (host.rag) { host.rag.place(host.home, 0); host.gesture = null; host.fallenFor = 0; host.getUp = 0; }
  else leno.place(stage.markers.host, stage.ground, stage.markers.stageCenter);
  mind.mood = 0; behavior.nausea = 0; behavior.transcript.length = 0;
  brood.clear(); goose.clear(); show.clear(); predators.clear(); happenings.clear(); convulseT = 0; cultists.ovation = 0;
  food.clear(); for (const n of npcs.list) n.remove(); npcs.list.length = 0; cultists.hidden.clear(); instincts.hunger = 0.4;
  sidebar.ticker('Show reset');
}

renderer.setAnimationLoop(() => {
  const rawDt = Math.min(0.05, clock.getDelta());
  const dt = paused ? 0 : rawDt;
  if (!paused) {
  director.update(dt);
  mind.update(dt);
  audience.update(dt);
  behavior.update(dt, { pan: leftOrRight() });
  if (lastMotor) {
    const adj = instincts.update(dt, host, lastMotor.command, window.flyleno?.lastTick?.rates);
    host.setMotor(adj.cmd);
    host.setPosture?.(adj.posture);
    behavior.eating = instincts.eating;
  }
  npcs.update(dt);
  director.hold = show.active;
  show.update(dt);
  predators.update(dt, true);                        // random visits, like the goose
  happenings.update(dt, true);
  if (convulseT > 0) {                               // after a zap: twitching
    convulseT -= dt;
    const r = () => (Math.random() - 0.5) * 2;
    if (host === flyHost) flyHost.vel.add(new THREE.Vector3(r(), 0, r()).multiplyScalar(0.8));
    else if (host.rag) { host.rag.applyImpulse('chest', new THREE.Vector3(r() * 40, r() * 25, r() * 40)); host.rag.applyImpulse('pelvis', new THREE.Vector3(r() * 30, 0, r() * 30)); }
  }
  brood.update(dt, host);
  goose.update(dt, true);                            // visits at random, on its own schedule
  // moving entities are solid too (stagehand, heckler, goose, hatchlings)
  if (entityCols) {
    const ents = npcs.list.map((n, i) => ({ key: n, pos: n.fig.position, radius: 0.45, height: 2.5 }));
    if (goose.active) ents.push({ key: goose.active, pos: goose.active.g.position, radius: 0.35, height: 1.1 });
    ents.push(...show.colliders());
    for (const y of brood.young) ents.push({ key: y, pos: y.kind === 'fly' ? y.body.pos : y.body.root.position, radius: y.kind === 'fly' ? 0.3 : 0.22, height: y.kind === 'fly' ? 0.5 : 0.85 });
    entityCols.sync(ents);
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
  if (stageScreens?.available) {
    if (stageScreens.greenGlow && stage.screens.glow) stage.screens.glow.color.set(0x33ff33);
    stageScreens.update(rawDt);
    const r = stageScreens.rates;
    $('eyeLBar').style.width = Math.min(100, r.L / 0.9).toFixed(0) + '%'; $('eyeLNum').textContent = r.L.toFixed(0);
    $('eyeRBar').style.width = Math.min(100, r.R / 0.9).toFixed(0) + '%'; $('eyeRNum').textContent = r.R.toFixed(0);
    $('visionNote').textContent = stageScreens.visionNote;
  }
  hearAcc += dt;
  if (hearAcc > 0.05) {
    hearAcc = 0;
    const h = hearing.update();
    stimRate('hearLow', h.low); stimRate('hearHigh', h.high);
    $('hearLowBar').style.width = (100 * h.low / hearing.maxRate).toFixed(0) + '%'; $('hearLowNum').textContent = h.low.toFixed(0);
    $('hearHighBar').style.width = (100 * h.high / hearing.maxRate).toFixed(0) + '%'; $('hearHighNum').textContent = h.high.toFixed(0);
  }
  if (tracking()) {
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
  controls.update();
  for (const l of stageLODs) l.update(camera.position);
  propLOD.update(camera, rawDt);
  liveCams?.update(rawDt);
  renderer.render(scene, camera);
  neuromap.render(rawDt);
});

window.flyleno = {
  scene, camera, controls, leno, stageScreens, brood, goose, show, showSfx, predators, happenings, stageLODs, propLOD, get host() { return host; }, setForm, stage, cultists, food, npcs, instincts, projectiles, liveCams, throwThing, worker, director, mind, audience, behavior, audio, music, hearing, fx, motorGains,
  get motor() { return lastMotor; },
};
