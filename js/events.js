// Event switches, Peaceful Mode and pacing.
//
// Switches: every random or scripted thing that can happen on the show has its own on/off switch (the Events
// panel in the sidebar). Harmful ones (things that hit, grab, soak, zap or punish the fly) are marked; Peaceful
// Mode turns all of those off at once and greys them out. The switches are remembered in this browser.
//
// Pacing: the big moments (predators, visitors, the rain cloud, the aliens, the Rapture, the frog, the car, the
// UFO) never overlap. Each asks the pacer before it starts; the pacer lets one through only when nothing big is
// going on and the stage has been calm for a while. Show segments give way to a random event that is waiting its
// turn, so the two interleave. While Leno sleeps nothing new starts (the show lets him rest).

// [key, label, harmful]
export const EVENT_GROUPS = [
  ['Visitors & predators', [
    ['goose', 'Goose visits', false],
    ['spider', 'Spider-Leno', true],
    ['swatter', 'Swatter glove', true],
    ['racket', 'Electric racket (rare swatter)', true],
    ['aliens', 'Mini grey aliens', true],
    ['frogTongue', "Mr. Frog's tongue", true],
    ['carBump', 'Car nudges him along', true],
  ]],
  ['Happenings', [
    ['rapture', 'The Rapture', false],
    ['rain', 'Rain cloud', true],
    ['mushroom', 'Vinesauce mushroom', false],
    ['rig', 'Falling cameras & lights', true],
  ]],
  ['Audience', [
    ['cheers', 'Cheers, laughs & applause', false],
    ['gasps', 'Gasps', false],
    ['boos', 'Boos', true],
    ['roses', 'Rose throws', false],
    ['sugar', 'Sugar-cube throws', false],
    ['roseStorms', 'Rose storms', false],
    ['ovations', 'Standing ovations', false],
    ['tomatoes', 'Tomato throws', true],
    ['pipes', 'Pipe throws', true],
    ['storms', 'Tomato & pipe storms', true],
    ['hecklers', 'Hecklers', true],
  ]],
  ['Stage crew & director', [
    ['snacks', 'Stagehand snacks', false],
    ['eclairs', 'Rotten éclairs', true],
    ['cueApplause', 'Applause cues (hearing)', false],
    ['cueDrives', 'Stroll / back-up drives', false],
    ['cueBitter', 'Bitter-taste cue', true],
  ]],
];

const STORE = 'flyleno.events.v1';

export class EventSwitches {
  constructor() {
    this.on = {};
    this.harmful = new Set();
    this.labels = {};
    for (const [, list] of EVENT_GROUPS) for (const [k, label, harm] of list) { this.on[k] = true; this.labels[k] = label; if (harm) this.harmful.add(k); }
    this.peaceful = false;
    this.listeners = [];
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) || 'null');
      if (saved) { Object.assign(this.on, saved.on || {}); this.peaceful = !!saved.peaceful; }
    } catch { /* storage unavailable: defaults */ }
  }

  /** register a switch that isn't in EVENT_GROUPS (show segments) */
  define(key, label, harmful = false) {
    if (!(key in this.on)) this.on[key] = true;
    this.labels[key] = label;
    if (harmful) this.harmful.add(key);
  }

  /** may this happen right now? (its switch is on, and Peaceful Mode isn't blocking it) */
  allowed(key) { return this.on[key] !== false && !(this.peaceful && this.harmful.has(key)); }
  blocked(key) { return this.peaceful && this.harmful.has(key); }

  set(key, v) { this.on[key] = !!v; this.save(); this.emit(); }
  setPeaceful(v) { this.peaceful = !!v; this.save(); this.emit(); }
  setAll(v) { for (const k in this.on) this.on[k] = !!v; this.save(); this.emit(); }
  onChange(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(this); }
  save() { try { localStorage.setItem(STORE, JSON.stringify({ on: this.on, peaceful: this.peaceful })); } catch { /* ignore */ } }
}

export class Pacer {
  constructor() {
    this.sources = [];          // [{ name, active() }]: big things that are on stage now
    this.calmT = 25;            // seconds since the last big thing ended
    this.minorT = 20;           // seconds since the last smaller event (storms, rig falls, ovations...)
    this.waiting = new Map();   // name -> time (s) it last asked for a turn and was told to wait
    this.t = 0;
    this.hold = false;          // Leno is asleep: nothing new starts
    this.busyNow = false;
  }

  watch(name, active) { this.sources.push({ name, active }); }

  /** names of the big things going on now */
  current() { return this.sources.filter((s) => s.active()).map((s) => s.name); }

  update(dt) {
    this.t += dt;
    this.busyNow = this.sources.some((s) => s.active());
    this.calmT = this.busyNow ? 0 : this.calmT + dt;
    this.minorT += dt;
    for (const [k, t] of this.waiting) if (this.t - t > 8) this.waiting.delete(k);
  }

  /** may a big event start now? `calm`: seconds of quiet it needs first. Show segments give way to waiting events. */
  canMajor(name, calm = 25) {
    const ok = !this.hold && !this.busyNow && this.calmT >= calm
      && !(name === 'show' && [...this.waiting.keys()].some((k) => k !== 'show'));
    if (!ok) this.waiting.set(name, this.t); else this.waiting.delete(name);
    return ok;
  }

  /** a big event has just started (so nothing else starts this same frame) */
  started() { this.busyNow = true; this.calmT = 0; }

  /** smaller events (storms, rig falls, ovations, the mushroom): not during a big one, not too close together */
  canMinor(gap = 12) { return !this.hold && !this.busyNow && this.minorT >= gap; }
  minorStarted() { this.minorT = 0; }
}

/** the Events panel: Peaceful Mode, then every switch by group (harmful ones marked, greyed out in Peaceful Mode) */
export function buildEventsPanel(el, sw, extraGroups = []) {
  const groups = [...EVENT_GROUPS, ...extraGroups];
  el.innerHTML = `
    <label class="chk peaceful" title="turns off everything that hits, grabs, soaks, zaps or punishes the fly (the greyed-out switches), and the brain worms">
      <input type="checkbox" id="optPeaceful"> 🕊 Peaceful Mode <small class="status">(no harmful events)</small></label>
    <div class="row ev-row"><button class="mini" data-all="1">all on</button><button class="mini" data-all="0">all off</button>
      <span class="status" style="margin-left:auto"><span class="harm-dot"></span> harmful</span></div>
    ${groups.map(([name, list]) => `<div class="ev-head">${name}</div><div class="ev-grid">${list.map(([k, label, harm]) =>
      `<label class="chk ev${harm ? ' harm' : ''}" data-ev="${k}"><input type="checkbox" data-ev="${k}"> ${label}</label>`).join('')}</div>`).join('')}`;
  const peace = el.querySelector('#optPeaceful');
  peace.onchange = () => sw.setPeaceful(peace.checked);
  el.querySelectorAll('button[data-all]').forEach((b) => (b.onclick = () => sw.setAll(b.dataset.all === '1')));
  el.querySelectorAll('input[data-ev]').forEach((i) => (i.onchange = () => sw.set(i.dataset.ev, i.checked)));
  const refresh = () => {
    peace.checked = sw.peaceful;
    el.querySelectorAll('label[data-ev]').forEach((l) => {
      const k = l.dataset.ev, inp = l.querySelector('input'), blocked = sw.blocked(k);
      inp.checked = sw.on[k] !== false && !blocked; inp.disabled = blocked;
      l.classList.toggle('grayed', blocked);
    });
  };
  sw.onChange(refresh);
  refresh();
}
