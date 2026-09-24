// "Show director": when autopilot is on, fires talk-show events at the fly's senses
// (and occasional fictive walking drive so the host wanders the stage).
const EVENTS = [
  { key: 'applause', text: 'The audience applauds', dur: [1.5, 3], weight: 4 },
  { key: 'snack', text: 'A stagehand offers a sugar cube', dur: [2, 4], weight: 2 },
  { key: 'heckler', text: 'A heckler lunges at the stage!', dur: [0.3, 0.6], weight: 1.5 },
  { key: 'tomato', text: 'Someone throws a rotten tomato', dur: [1, 2], weight: 1 },
  { key: 'walk', text: 'Host strolls the stage', dur: [2, 5], weight: 3, with: ['turnL', 'turnR'] },
  { key: 'reverse', text: 'Host backs away', dur: [0.8, 1.5], weight: 0.6 },
];

export class Director {
  constructor(setStim, onEvent, actions = {}) {
    this.setStim = setStim;       // (key, on:boolean) => void
    this.actions = actions;       // key -> () => bool: events acted out by characters instead of direct stimulation
    this.onEvent = onEvent;
    this.enabled = true;
    this.next = 2;
    this.active = [];             // {keys, until}
    this.t = 0;
  }

  update(dt) {
    this.t += dt;
    for (const a of this.active) {
      if (this.t >= a.until) { a.keys.forEach((k) => this.setStim(k, false)); a.done = true; }
    }
    this.active = this.active.filter((a) => !a.done);
    if (!this.enabled || this.hold || this.t < this.next) return;       // hold: a show segment is running, or he's asleep
    // only events whose switch is on (js/events.js)
    const pool = EVENTS.filter((e) => !this.allow || this.allow(e.key));
    if (!pool.length) { this.next = this.t + 5; return; }
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total, ev = pool[0];
    for (const e of pool) { if ((r -= e.weight) <= 0) { ev = e; break; } }
    const dur = ev.dur[0] + Math.random() * (ev.dur[1] - ev.dur[0]);
    if (this.actions[ev.key]?.()) { this.onEvent?.(ev.text, []); this.next = this.t + 6 + Math.random() * 5; return; }
    const keys = [ev.key];
    if (ev.with && Math.random() < 0.7) keys.push(ev.with[Math.floor(Math.random() * ev.with.length)]);
    keys.forEach((k) => this.setStim(k, true));
    this.active.push({ keys, until: this.t + dur });
    this.onEvent?.(ev.text, keys);
    this.next = this.t + dur + 1.5 + Math.random() * 4;
  }

  /** Called when the brain is stuck in self-sustained activity: go to a commercial break. */
  commercialBreak(reset) {
    this.stopAll();
    this.onEvent?.('Commercial break! (runaway brain activity: resetting the fly)', []);
    reset();
    this.next = this.t + 3;
  }

  stopAll() {
    for (const a of this.active) a.keys.forEach((k) => this.setStim(k, false));
    this.active = [];
  }
}
