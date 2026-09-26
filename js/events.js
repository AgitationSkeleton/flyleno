// Event switches and Peaceful Mode.
//
// Switches: every random or scripted thing that can happen on the show has its own on/off switch (the Events
// panel in the sidebar). Harmful ones (things that hit, grab, soak, zap or punish the fly) are marked; Peaceful
// Mode turns all of those off at once and greys them out. The switches are remembered in this browser.

// [key, label, harmful]
export const EVENT_GROUPS = [
  ['Visitors & predators', [
    ['goose', 'Goose visits', false],
    ['spider', 'Spider-Leno', true],
    ['swatter', 'Swatter glove', true],
    ['racket', 'Electric racket', true],
    ['aliens', 'Duendes', true],
    ['frogTongue', "Mr. Frog's tongue and gun", true],
    ['carBump', 'Car nudges', true],
    ['clowns', 'Clown car', true],
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
    ['cueApplause', 'Applause cues', false],
    ['cueDrives', 'Walk drives', false],
    ['cueBitter', 'Bitter-taste cue', true],
    ['wbrb', "We'll Be Right Back", false],
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

/** the Events panel: Peaceful Mode, then every switch by group (harmful ones marked, greyed out in Peaceful Mode) */
export function buildEventsPanel(el, sw, extraGroups = []) {
  const groups = [...EVENT_GROUPS, ...extraGroups];
  el.innerHTML = `
    <label class="chk peaceful"><input type="checkbox" id="optPeaceful"> 🕊 Peaceful Mode</label>
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
