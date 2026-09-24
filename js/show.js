// The Grey Leno Show, as a running order. Each episode opens with the greeting, runs a handful of segments drawn
// from Vinny's Grey Leno appearances (the 2022 Nightmare Puppeteer show, the VR / public-access / VHS follow-ups,
// the candidacy speech) and ends with the UFO sign-off. Every segment is a set of stimuli for the fly (sounds it
// hears, light and screen pictures it sees, touch, looming, fictive drives) plus crowd reactions that reach its
// dopamine neurons. The host's scripted lines are not shown (the fly brain does the talking): where a segment
// needs an answer from Leno (the phone-in, the monologue) it drives the fly's own voice neurons and quotes whatever
// comes out.
//
// Pacing: an episode alternates calm segments with busy ones (a guest, a party), prefers segments it didn't run
// last time, and may end on the late late show's lullaby. Between segments there is room to wander; the show waits
// for the stage to be clear of big random events (js/events.js) and gives way to one that is waiting its turn.
// Nothing here flashes: lights fade, screens move smoothly (photosensitivity).
import * as THREE from 'three';
import { Frog } from './frog.js';
import { Car } from './car.js';
import { FollowSpot, BandStand, DiscoLights, Confetti, Balloons, Ufo } from './props.js';
import { makeCard } from './cards.js';

const pick = (a) => a[(Math.random() * a.length) | 0];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// syllable formants (F1, F2) for crowd chants
const V = { EY: [480, 1900], EH: [560, 1750], OW: [520, 900], AE: [700, 1700], IH: [420, 2000] };

// pace: 'calm' (talk, screens) or 'big' (a guest, props, a party); major: fills the stage (no big random event
// alongside it); harmful: switched off in Peaceful Mode
export const SEGMENTS = {
  open: { title: 'Opening', dur: 16 },
  clip: { title: '"Take a look at this next one"', dur: 32, pace: 'calm' },
  monologue: { title: 'Monologue: joke time', dur: 30, pace: 'calm' },
  phonein: { title: 'Phone-in: the fly answers', dur: 18, pace: 'calm' },
  johnny: { title: '"Take it away, Johnny!"', dur: 13, pace: 'calm' },
  sponsor: { title: 'A word from our sponsor', dur: 14, pace: 'calm' },
  static: { title: 'Technical difficulties', dur: 11, pace: 'calm' },
  telethon: { title: 'Space scabies telethon', dur: 24, pace: 'calm' },
  eclair: { title: 'The rotten éclair', dur: 30, pace: 'calm', harmful: true },
  guest: { title: 'Guest: Mr. Frog', dur: 60, pace: 'big', major: true },
  gooseguest: { title: 'Guest: a goose', dur: 40, pace: 'big', major: true },
  drive: { title: 'Sunday drive', dur: 55, pace: 'big', major: true },
  dance: { title: 'Grey Leno dance party', dur: 22, pace: 'big' },
  rally: { title: 'Vote Leno', dur: 32, pace: 'big' },
  birthday: { title: '500 years young (birthday)', dur: 42, pace: 'big' },
  wave: { title: 'The Leno Wave', dur: 17, pace: 'big' },
  wheel: { title: 'Spin the Wheel of Leno', dur: 24, pace: 'big' },
  lullaby: { title: 'The late late show: lullaby', dur: 36, pace: 'late' },
  signoff: { title: 'Sign-off (UFO)', dur: 26, major: true },
};
const MIDDLE = Object.keys(SEGMENTS).filter((k) => SEGMENTS[k].pace === 'calm' || SEGMENTS[k].pace === 'big');

// callers (the questions are heard as a garbled voice on the line and shown in the ticker; the answer is the fly's)
const CALLS = [
  'Why do you puke so much?',
  'Can you address the elephant in the room: who are the hooded chaps in the back?',
  'I really love how incredibly unfunny you are. Clone Orion is so much better.',
  'Tell me, what do you drive?',
  'Is it true you are 500 years old?',
  'What do the worms in your brain tell you?',
  'Are feet really going to be free?',
  "Where's Johnny?",
];

export class Show {
  /**
   * ctx: { scene, stage, audio, sfx, screens, npcs, getHost, isFly, hostPos, hostHead, impulse, backflip,
   *        stimAlias, pulse, reinforce, setStim, crowd, react, ticker, cue, motor, duckMusic, voice, mouthOpen,
   *        deliverSnack, onChange, allowed(switch), pacer, said() (words spoken so far), transcript(),
   *        happen(kind) (a prize), gooseVisit(), gooseHead(), wave(laps), dim(level), lullaby(on), asleep() }
   */
  constructor(ctx) {
    this.ctx = ctx;
    const { scene, stage, sfx } = ctx;
    const c = stage.markers.stageCenter.position;
    this.center = new THREE.Vector3(c[0], c[1], c[2]);
    this.floorY = c[1];
    this.frog = new Frog({ scene, stage, sfx, onEvent: (t, d) => this.frogEvent(t, d) });
    if (stage.markers.guest) { const g = stage.markers.guest.position; this.frog.guestSpot = new THREE.Vector3(g[0], g[1], g[2]); }
    this.car = new Car({ scene, stage, sfx, onEvent: (t) => this.carEvent(t) });
    this.spot = new FollowSpot(scene, this.center.clone().add(new THREE.Vector3(0, 16, 14)));
    this.bandAt = this.center.clone().add(new THREE.Vector3(-6.2, 0, -2.2));
    this.band = new BandStand(scene, this.bandAt);
    this.disco = new DiscoLights(scene, this.center);
    this.confetti = new Confetti(scene); this.confetti.floorY = this.floorY;
    this.balloons = new Balloons(scene); this.balloons.floorY = this.floorY;
    this.ufo = new Ufo(scene);
    this.enabled = true;
    this.gentle = false;             // Peaceful Mode: the tractor beam only lifts him a little
    this.episode = 0;
    this.rundown = [];
    this.recent = [];                // last episode's segments (the next one prefers others)
    this.idx = -1;
    this.cur = null;                 // { key, t, s (segment state) }
    this.gap = 6;
    this.light = 0;                  // extra light on the host's eyes this frame (0..1)
  }

  get active() { return !!this.cur; }
  /** a segment that fills the stage is on (for the pacer) */
  get busy() { return !!this.cur || this.ufo.state !== 'off' || this.frog.present || this.car.present; }

  allowed(key) { return this.ctx.allowed?.('seg:' + key) ?? true; }

  newEpisode() {
    this.episode++;
    // alternate calm and busy segments, preferring ones that weren't on last time
    const pool = MIDDLE.filter((k) => this.allowed(k));
    const order = [...shuffle(pool.filter((k) => !this.recent.includes(k))), ...shuffle(pool.filter((k) => this.recent.includes(k)))];
    const calm = order.filter((k) => SEGMENTS[k].pace === 'calm'), big = order.filter((k) => SEGMENTS[k].pace === 'big');
    const mid = [];
    let wantBig = Math.random() < 0.5;
    while (mid.length < 5 && (calm.length || big.length)) {
      mid.push(((wantBig && big.length) || !calm.length ? big : calm).shift());
      wantBig = !wantBig;
    }
    // the late late show: sometimes the lullaby closes the episode, just before the sign-off
    const late = this.allowed('lullaby') && Math.random() < 0.35 ? ['lullaby'] : [];
    this.rundown = [...(this.allowed('open') ? ['open'] : []), ...mid, ...late, ...(this.allowed('signoff') ? ['signoff'] : [])];
    this.recent = mid;
    this.idx = -1;
    this.ctx.onChange?.();
  }

  /** start a segment now (from the rundown or a button) */
  run(key) {
    if (this.cur) this.stopSegment();
    if (!this.rundown.length) this.newEpisode();
    this.cur = { key, t: 0, s: {}, fired: new Set() };
    this.start(key, this.cur.s);
    this.ctx.onChange?.();
  }

  stopSegment() {
    const C = this.cur;
    if (!C) return;
    this.stop(C.key, C.s);
    this.cur = null;
    // room to wander between segments; a longer intermission between episodes
    this.gap = this.idx >= this.rundown.length - 1 ? 50 + Math.random() * 50 : 14 + Math.random() * 16;
    this.ctx.onChange?.();
  }

  /** stop everything (show reset) */
  clear() {
    this.stopSegment();
    this.frog.clear(); this.car.clear(); this.ufo.clear(); this.confetti.clear(); this.balloons.clear();
    this.disco.stop(); this.spot.off();
    this.rundown = []; this.idx = -1; this.gap = 6;
    this.ctx.onChange?.();
  }

  update(dt) {
    if (!dt) return;
    const ctx = this.ctx;
    const C = this.cur;
    if (C) {
      C.t += dt;
      const done = this.step(C.key, C.s, C.t, dt, C);
      if (done || C.t > (SEGMENTS[C.key].dur + 30)) this.stopSegment();
    } else if (this.enabled) {
      this.gap -= dt;
      if (this.gap <= 0) {
        if (!this.rundown.length || this.idx >= this.rundown.length - 1) this.newEpisode();
        // skip segments that have been switched off since the rundown was made
        while (this.idx < this.rundown.length - 1 && !this.allowed(this.rundown[this.idx + 1])) this.idx++;
        const next = this.rundown[this.idx + 1];
        // wait until the stage is clear (and let a random event that's waiting go first)
        if (next && (!ctx.pacer || ctx.pacer.canMajor('show', SEGMENTS[next].major ? 15 : 6))) {
          this.idx++;
          this.run(next);
          if (SEGMENTS[next].major) ctx.pacer?.started();
        }
      }
    }
    // props
    const hp = ctx.hostPos(), head = ctx.hostHead();
    this.frog.update(dt, { hostIsFly: ctx.isFly(), hostMouthOpen: ctx.mouthOpen(), voice: ctx.voice() });
    this.car.update(dt, hp);
    this.spot.update(dt);
    const flash = this.disco.update(dt);
    this.ufo.update(dt);
    this.balloons.update(dt);
    const touched = this.confetti.update(dt, [head, hp.clone().add(new THREE.Vector3(0, 1.2, 0))]);
    if (touched) {
      // paper on the antennae and body: Johnston's organ + mechanosensory bristles (-> grooming)
      ctx.pulse('confetti', 'applause', 150, 0.5); ctx.pulse('confettiTouch', 'ambientTouch', 30, 0.5);
      if (!this.confettiSaid) { this.confettiSaid = true; ctx.ticker('Confetti settles on Leno\'s antennae'); }
    }
    // floor rumble from the car (leg mechanosensors)
    ctx.stimAlias('carRumble', 'ambientTouch', 70 * this.car.rumbleAt(hp));
    // tractor beam: light + lift
    const beam = this.ufo.inBeam(hp);
    if (beam > 0) {
      // lift him a few metres and hold him there (about his own weight at the top) until the beam lets go;
      // in Peaceful Mode only a little way, so the drop is nothing
      const room = THREE.MathUtils.clamp((this.floorY + (this.gentle ? 1.6 : 5.5) - head.y) / 1.5, 0, 1);
      ctx.impulse(new THREE.Vector3(0, (ctx.isFly() ? 900 * room : 850 + 1800 * room) * beam * dt, 0));
    }
    // light falling on the eyes (spotlight, strobe, beam)
    this.light = Math.min(1, this.spot.on01(hp) * 0.5 + flash * 0.8 + beam);
    ctx.stimAlias('lightL', 'eyeL', 40 * this.light);
    ctx.stimAlias('lightR', 'eyeR', 40 * this.light);
  }

  /** things that loom toward the fly: [{ p, r }] */
  loomers() {
    const out = [];
    const tip = this.frog.tipPos(); if (tip) out.push({ p: tip, r: 0.35 });
    const fr = this.car.front(); if (fr) out.push({ p: fr, r: 1.4 });
    if (this.ufo.state === 'arrive') out.push({ p: this.ufo.g.position, r: 2.6 });
    return out;
  }

  /** solid moving props */
  colliders() {
    const out = [...this.car.colliders()];
    if (this.frog.active) out.push({ key: 'frog', pos: this.frog.active.g.position, radius: 0.6, height: 1.3 });
    return out;
  }

  // ---------------------------------------------------------------- the fly answers
  /** open the fly's voice for `sec` seconds (a fictive drive onto its vocal descending neurons) */
  speakUp(s) { s.vOn = true; s.v = 0; s.w0 = this.ctx.said(); this.ctx.setStim('vocal', true); }
  /** close it again; returns what he said in the meantime ('' if nothing) and how loud he got */
  speakDone(s) {
    if (!s.vOn) return { said: '', v: 0 };
    s.vOn = false; this.ctx.setStim('vocal', false);
    const n = Math.min(12, this.ctx.said() - s.w0);
    return { said: n > 0 ? this.ctx.transcript().slice(-n).join(' ') : '', v: s.v };
  }

  // ---------------------------------------------------------------- segments
  /** run `fn` once when segment time passes `at` */
  at(C, at, fn) { if (C.t >= at && !C.fired.has(at)) { C.fired.add(at); fn(); } }

  start(key, s) {
    const ctx = this.ctx;
    ctx.ticker(`▶ ${SEGMENTS[key].title}`);
    if (key === 'open') {
      ctx.screens?.showCard(makeCard('title'), 11);
      this.ctx.sfx.sting('fanfare', { gain: 0.6 });
      ctx.cue('Hey everybody and welcome to the Grey Leno Show!');
      ctx.crowd('applause', 1); this.spot.on(() => ctx.hostHead());
    }
    if (key === 'clip') {
      ctx.cue('Jesus Christ, take a look at this next one, huh?');
      s.prevMode = ctx.screens?.mode;
      if (ctx.screens?.available) ctx.screens.setMode('video');
    }
    if (key === 'monologue') { this.spot.on(() => ctx.hostHead()); s.jokes = 0; s.next = 1.5; ctx.ticker('The spotlight finds Leno: joke time'); }
    if (key === 'phonein') { this.ctx.sfx.sting('ring', { gain: 0.8 }); s.call = pick(CALLS); ctx.ticker('📞 The phone on the desk rings'); }
    if (key === 'guest') ctx.cue("We're gonna have a guest, Mr. Frog. Mr. Frog will be on… at some point.");
    if (key === 'gooseguest') {
      s.ok = ctx.gooseVisit();
      if (s.ok) { ctx.ticker('Our next guest… a goose!'); ctx.crowd('applause', 0.9); this.spot.on(() => ctx.gooseHead() ?? ctx.hostHead(), 700); }
    }
    if (key === 'drive') { ctx.cue("This next one is really beautiful, okay? It's like a Sunday drive."); this.car.enter(); }
    if (key === 'johnny') { ctx.cue('Here we go, here we go, everybody. Take it away, Johnny!'); this.spot.on(this.bandAt.clone().add(new THREE.Vector3(0, 1.5, 0))); }
    if (key === 'sponsor') {
      ctx.cue('All right everybody, this next bit is brought to you by our sponsor: Gronk.');
      ctx.screens?.showCard(makeCard('gronk'), 7); this.ctx.sfx.sting('fanfare', { gain: 0.7 });
    }
    if (key === 'static') {
      ctx.screens?.showCard(makeCard('static'), 8); this.ctx.sfx.sting('static', { gain: 0.8 });
      ctx.ticker('The screens dissolve into static');
    }
    if (key === 'telethon') {
      ctx.screens?.showCard(makeCard('telethon'), 22);
      ctx.cue("Help us find the cure for space scabies, which I definitely don't have.");
      s.itchT = 1;
    }
    if (key === 'dance') {
      ctx.cue("It's time for the Grey Leno dance party!");
      this.disco.start(); s.beat = this.ctx.sfx.beat({ gain: 0.55 }); s.side = 0; s.swayT = 0;
      ctx.crowd('cheer', 1);
    }
    if (key === 'rally') {
      ctx.screens?.showCard(makeCard('vote'), 30);
      ctx.cue("My fellow contrarians, it's me, Grey Leno. I am here today to announce that I will be running.");
    }
    if (key === 'birthday') {
      // "I'm 500 years young, folks": a cake, a song, balloons
      ctx.ticker("It's Leno's birthday: 500 years young!");
      s.ok = ctx.deliverSnack('cake');
      ctx.screens?.showCard(makeCard('birthday'), 16);
      this.balloons.drop(this.center, 14); ctx.crowd('cheer', 0.9);
    }
    if (key === 'wave') { ctx.ticker('Everybody do the Leno Wave!'); ctx.crowd('cheer', 0.7); }
    if (key === 'wheel') {
      // the prize is decided up front; the wheel is drawn to land on it
      const prizes = this.prizes();
      s.prize = pick(prizes);
      s.card = makeCard('wheel', { labels: prizes.map((p) => p.label), pick: prizes.indexOf(s.prize), spin: 6.5 });
      ctx.screens?.showCard(s.card, 15);
      this.ctx.sfx.sting('wheel', { gain: 0.6 });
      ctx.ticker('Spin the Wheel of Leno!');
    }
    if (key === 'lullaby') {
      ctx.ticker('The late late show: the lights go down…');
      ctx.dim(0.45); ctx.duckMusic(0.3); ctx.lullaby(true);
      s.box = this.ctx.sfx.musicBox({ dur: 28, gain: 0.5 });
    }
    if (key === 'eclair') {
      ctx.cue('Mmm. An éclair, huh? Beautiful.');
      s.ok = ctx.deliverSnack('eclair');
    }
    if (key === 'signoff') {
      ctx.cue("Anyway, that's all the time we have for today. This is Grey Leno signing out.");
      ctx.crowd('applause', 1);
    }
  }

  /** the wheel's prizes (all harmless except the tomatoes, which only appear when tomato storms are allowed) */
  prizes() {
    const ctx = this.ctx, ok = (k) => ctx.allowed?.(k) ?? true;
    return [
      { label: 'SUGAR SHOWER', run: () => ctx.happen('sugar'), ok: ok('sugar') },
      { label: 'ROSES', run: () => ctx.happen('roses'), ok: ok('roseStorms') },
      { label: 'OVATION', run: () => ctx.happen('ovation'), ok: ok('ovations') },
      { label: 'CONFETTI', run: () => { this.confetti.drop(this.center); this.balloons.drop(this.center, 12); this.confettiSaid = false; this.ctx.sfx.sting('pop', { gain: 0.8 }); }, ok: true },
      { label: 'A GOOSE', run: () => ctx.gooseVisit(), ok: ok('goose') },
      { label: 'MUSHROOM', run: () => ctx.happen('mushroom'), ok: ok('mushroom') },
      { label: 'NOTHING', run: () => { this.ctx.sfx.sting('crickets', { gain: 0.7 }); ctx.ticker('…nothing. Better luck next time.'); }, ok: true },
      { label: 'TOMATOES!', run: () => ctx.happen('storm'), ok: ok('storms') },
    ].filter((p) => p.ok);
  }

  step(key, s, t, dt, C) {
    const ctx = this.ctx;
    if (s.vOn) s.v = Math.max(s.v, ctx.voice());
    if (key === 'open') {
      this.at(C, 4, () => { ctx.cue('Today we have a show.'); ctx.crowd('applause', 1); ctx.crowd('cheer', 0.8); ctx.ticker('The audience bursts into applause at nothing'); });
      this.at(C, 8, () => ctx.cue("We have a whole cavalcade of different material that you will enjoy to your heart's consent!"));
      this.at(C, 11.5, () => {
        ctx.cue('Thank you, thank you. Beautiful crowd, beautiful crowd.');
        this.ctx.sfx.chant({ n: 4, period: 1.15, vowels: [V.EY, V.EH, V.OW] });               // "GREY LE-NO"
      });
      if (t > SEGMENTS.open.dur) { this.spot.off(); return true; }
    }
    if (key === 'clip') {
      if (t > 26 && !s.back) {
        s.back = true;
        if (ctx.screens?.available && s.prevMode && s.prevMode !== 'video') ctx.screens.setMode(s.prevMode);
        ctx.cue("Now that was another amazing bit. I ain't never seen nothing like that in my life, don't you agree, huh?");
        ctx.crowd('applause', 0.9);
      }
      return t > SEGMENTS.clip.dur;
    }
    if (key === 'monologue') {
      // three "jokes": his voice neurons get a push, then a rimshot; the crowd laughs if he said something
      s.next -= dt;
      if (!s.vOn && s.next <= 0 && s.jokes < 3) { this.speakUp(s); s.tellT = 0; }
      if (s.vOn) {
        s.tellT += dt;
        if (s.tellT > 2.8) {
          const { said, v } = this.speakDone(s);
          s.jokes++; s.next = 4;
          if (said || v > 0.35) {
            if (said) ctx.ticker(`Leno: "${said}"`);
            this.ctx.sfx.sting('rimshot', { gain: 0.7 });
            setTimeout(() => ctx.crowd(Math.random() < 0.7 ? 'laugh' : 'applause', 0.8), 900);
          } else { this.ctx.sfx.sting('crickets', { gain: 0.7 }); ctx.ticker('…nothing. Tough crowd.'); }
        }
      }
      if (s.jokes >= 3 && s.next <= 1.5) { this.spot.off(); return true; }
      return false;
    }
    if (key === 'phonein') {
      this.at(C, 3.2, () => { this.ctx.sfx.sting('caller', { gain: 0.8 }); ctx.ticker(`Caller: "${s.call}"`); });
      // the answer comes from the fly: a push onto its voice neurons, and whatever they say is the reply
      this.at(C, 7, () => { this.speakUp(s); ctx.ticker('Leno answers the caller…'); });
      this.at(C, 11.5, () => {
        const { said, v } = this.speakDone(s);
        if (said || v > 0.35) {
          ctx.ticker(said ? `Leno answers: "${said}"` : 'Leno mumbles an answer');
          ctx.crowd(Math.random() < 0.6 ? 'laugh' : 'applause', 0.8);
        } else { this.ctx.sfx.sting('crickets', { gain: 0.7 }); ctx.ticker('…silence. The caller hangs up.'); }
      });
      return t > SEGMENTS.phonein.dur;
    }
    if (key === 'guest') {
      this.at(C, 3, () => { ctx.cue('Give it up for Mr. Frog!'); ctx.crowd('applause', 1); this.frog.enter(ctx.getHost, 48); this.spot.on(() => this.frog.headPos() ?? ctx.hostHead(), 700); });
      if (this.frog.active?.state === 'sit') {
        s.askT = (s.askT ?? 2) - dt;
        if (s.askT <= 0) {
          s.askT = 7 + Math.random() * 5;
          ctx.cue(pick(['So tell me, Mr. Frog, do you drive a car?', 'Hey, do you drive a scooter? Because the scooter is a pretty cool thing.',
            'Hey frog, why are you looking at me like that?', "You know, big famous movie stars don't get to boss me around, huh.",
            'You know, my name is Grey Leno, because I was a crossbreed between Jay Leno and a grey alien.', 'Mr. Frog, welcome back. How you doing?']));
        }
      }
      if (t > 3.5 && !this.frog.active) { this.spot.off(); return true; }
    }
    if (key === 'gooseguest') {
      if (!s.ok) return true;
      this.at(C, 12, () => ctx.crowd('laugh', 0.8));
      if (t > 3 && !ctx.gooseHead()) { this.spot.off(); ctx.crowd('applause', 0.8); return true; }
      return t > SEGMENTS.gooseguest.dur;
    }
    if (key === 'drive') {
      this.at(C, 12, () => ctx.cue('Tell me, do you drive a car? What do you drive?'));
      if (t > 2 && !this.car.present) { ctx.cue('Drive your cars home safe, folks.'); return true; }
    }
    if (key === 'johnny') {
      if (!s.ducked) { s.ducked = true; ctx.duckMusic(0.08); }
      this.at(C, 2.5, () => { this.ctx.sfx.sting('crickets', { gain: 0.8 }); ctx.ticker("…silence. Johnny's stool is empty."); });
      this.at(C, 6, () => { ctx.cue("Huh, where's Johnny? Johnny? …Jay, where are you?"); ctx.crowd('laugh', 0.9); });
      this.at(C, 9, () => { this.ctx.sfx.sting('rimshot', { gain: 0.8 }); this.spot.on(() => ctx.hostHead()); ctx.duckMusic(1); s.ducked = false; });
      if (t > SEGMENTS.johnny.dur) { this.spot.off(); return true; }
    }
    if (key === 'sponsor') {
      this.at(C, 7, () => { ctx.screens?.showCard(makeCard('nft'), 6); ctx.cue('Buy these new Grey Leno NFTs, huh? Sub to my Patreon, guys, I don\'t want to have to get a real job.'); });
      this.at(C, 13, () => ctx.crowd('applause', 0.7));
      return t > SEGMENTS.sponsor.dur;
    }
    if (key === 'static') {
      this.at(C, 2.5, () => ctx.cue('Dave, can you fix the static? Huh? Dave?'));
      this.at(C, 9, () => ctx.cue('Beautiful. Beautiful.'));
      return t > SEGMENTS.static.dur;
    }
    if (key === 'telethon') {
      // space scabies: itching bristles and antennae -> the fly grooms
      s.itchT -= dt;
      if (s.itchT <= 0) { s.itchT = 1.2 + Math.random() * 1.8; ctx.pulse('itch', 'ambientTouch', 80, 0.5); ctx.pulse('itchAnt', 'applause', 110, 0.4); }
      this.at(C, 10, () => ctx.cue('Three out of four Martians have the same problem.'));
      this.at(C, 20, () => ctx.crowd('applause', 0.8));
      return t > SEGMENTS.telethon.dur;
    }
    if (key === 'dance') {
      // "my body is moving on its own": fictive left/right turning drives on the beat
      s.swayT -= dt;
      if (s.swayT <= 0) {
        s.swayT = 60 / 124 * 2;
        ctx.setStim(s.side ? 'turnL' : 'turnR', false); s.side ^= 1; ctx.setStim(s.side ? 'turnL' : 'turnR', true);
      }
      this.at(C, 8, () => ctx.cue("Oh, my body is moving on its own, baby… I really don't know how to stop this."));
      this.at(C, 14, () => ctx.cue('Break dancing, break dancing, break dancing!'));
      return t > SEGMENTS.dance.dur;
    }
    if (key === 'rally') {
      this.at(C, 3, () => {
        this.confetti.drop(this.center); this.balloons.drop(this.center); this.confettiSaid = false;
        this.ctx.sfx.sting('pop', { gain: 0.9 }); ctx.crowd('cheer', 1);
        this.ctx.sfx.chant({ n: 8, period: 0.9, vowels: [V.EH, V.OW] });                     // "LE-NO! LE-NO!"
      });
      this.at(C, 10, () => ctx.cue('Taxes are low, slugs are high, and feet will always be free.'));
      this.at(C, 14, () => {
        ctx.cue('Folks, I can do a backflip.');
        this.ctx.sfx.chant({ n: 5, period: 0.8, vowels: [V.AE, V.IH] });                     // "BACK-FLIP!"
        s.flipFrom = t; s.flipped = false;
      });
      // the backflip happens only if the fly's giant fibre fires (an escape jump) in the next 9 s
      if (s.flipFrom !== undefined && !s.flipped && t - s.flipFrom < 9 && (ctx.motor()?.startle ?? 0) > 0.6) {
        s.flipped = true; ctx.backflip(); ctx.ticker('Giant-fibre volley: Leno does a backflip!'); ctx.react('backflip');
      }
      this.at(C, 23.5, () => { if (!s.flipped) { ctx.ticker('No backflip.'); ctx.react('backflipFail'); } });
      this.at(C, 27, () => ctx.cue('Vote Leno in the fall, and may all your ambidextrances come true.'));
      return t > SEGMENTS.rally.dur;
    }
    if (key === 'birthday') {
      this.at(C, 6, () => { this.ctx.sfx.birthday({ gain: 0.55 }); ctx.ticker('The audience sings Happy Birthday'); });
      this.at(C, 17, () => { ctx.crowd('applause', 1); ctx.crowd('cheer', 0.8); this.confetti.drop(this.center, 5, 16, 400); this.confettiSaid = false; });
      this.at(C, 20, () => { if (s.ok) ctx.ticker('The cake is on the floor in front of him. Five hundred candles, give or take.'); });
      return t > SEGMENTS.birthday.dur;
    }
    if (key === 'wave') {
      // the audience does a stadium wave, three times round, chanting his name
      this.at(C, 1.5, () => { ctx.wave(3); this.ctx.sfx.chant({ n: 6, period: 1.6, gain: 0.5, vowels: [V.EH, V.OW] }); });
      this.at(C, 13, () => ctx.crowd('applause', 0.9));
      return t > SEGMENTS.wave.dur;
    }
    if (key === 'wheel') {
      this.at(C, 7.4, () => {
        ctx.ticker(`The wheel lands on: ${s.prize.label}!`);
        this.ctx.sfx.sting('fanfare', { gain: 0.6 });
        setTimeout(() => s.prize.run(), 900);
      });
      this.at(C, 12, () => ctx.crowd(s.prize.label === 'NOTHING' ? 'laugh' : 'applause', 0.8));
      return t > SEGMENTS.wheel.dur;
    }
    if (key === 'lullaby') {
      // the audience hushes; if he nods off, a soft "aww"
      if (!s.aww && ctx.asleep()) { s.aww = true; ctx.ticker('Leno dozes off. The audience whispers "aww"'); ctx.crowd('applause', 0.25); }
      this.at(C, 29, () => { ctx.dim(1); ctx.duckMusic(1); ctx.lullaby(false); ctx.ticker('The lights come back up, slowly'); });
      return t > SEGMENTS.lullaby.dur;
    }
    if (key === 'eclair') {
      if (!s.ok) return true;
      return t > SEGMENTS.eclair.dur;
    }
    if (key === 'signoff') {
      this.at(C, 4, () => {
        ctx.cue("Goodbye now, drive your car home safe… I'm gonna get my UFO.");
        this.ufo.arrive(() => ctx.hostPos(), { hoverY: this.floorY + 9, beamAt: 2, beamDur: 8 });
        s.hum = this.ctx.sfx.ufo({ gain: 0.45 });
      });
      this.at(C, 9, () => ctx.ticker('The tractor beam takes hold of Leno'));
      if (C.fired.has(4) && this.ufo.state === 'leave' && !s.left) { s.left = true; s.hum?.stop(); ctx.crowd('applause', 1); }
      if (C.fired.has(4) && this.ufo.state === 'off') return true;
    }
    return false;
  }

  stop(key, s) {
    const ctx = this.ctx;
    this.speakDone(s);
    if (key === 'clip' && !s.back && ctx.screens?.available && s.prevMode && s.prevMode !== 'video') ctx.screens.setMode(s.prevMode);
    if (key === 'guest') this.frog.leave('done');
    if (key === 'drive' && this.car.present) this.car.active.phase = 'out';
    if (key === 'johnny' && s.ducked) ctx.duckMusic(1);
    if (key === 'dance') { this.disco.stop(); s.beat?.stop(); ctx.setStim('turnL', false); ctx.setStim('turnR', false); ctx.crowd('cheer', 0.8); }
    if (key === 'lullaby') { s.box?.stop(); ctx.dim(1); ctx.duckMusic(1); ctx.lullaby(false); }
    if (key === 'signoff') { s.hum?.stop(); if (this.ufo.state !== 'off') this.ufo.state = 'leave'; }
    if (['open', 'johnny', 'guest', 'monologue', 'gooseguest'].includes(key)) this.spot.off();
    if (['sponsor', 'static', 'telethon', 'rally', 'open', 'birthday', 'wheel'].includes(key)) ctx.screens?.clearCard();
  }

  // ---------------------------------------------------------------- guests
  frogEvent(type, d = {}) {
    const ctx = this.ctx;
    if (type === 'enter') ctx.ticker('Mr. Frog hops onto the stage');
    if (type === 'croak') ctx.ticker(`Mr. Frog: "${'Good. '.repeat(d.n).trim()}"`);
    if (type === 'tongue') ctx.pulse('frogLoom', 'heckler', 220, 0.3);                       // LC4: something shoots at him
    if (type === 'hit') {
      ctx.pulse('frogHit', 'ambientTouch', 90, 0.5); ctx.reinforce(-0.5, 0.8); ctx.react('frogTongue');
      if (d.caught) {
        ctx.ticker('Mr. Frog catches Fly-Leno with his tongue!');
        const fp = this.frog.headPos(); if (fp) ctx.impulse(fp.sub(ctx.hostPos()).multiplyScalar(90));
      } else ctx.ticker("Mr. Frog's tongue slaps Leno");
    }
    if (type === 'spit') {
      ctx.ticker('…and spits him back out. Too grey.');
      const away = ctx.hostPos().sub(this.frog.headPos() ?? this.center).setY(0).normalize().multiplyScalar(260).add(new THREE.Vector3(0, 200, 0));
      ctx.impulse(away); ctx.react('frogSpit');
    }
    if (type === 'leave') {
      if (d.reason === 'bite') { ctx.cue("I'll just inch my way over and I'll bite your ankles, huh!"); ctx.ticker("Leno bites Mr. Frog's ankles"); ctx.react('frogBite'); }
      else if (d.reason === 'yell') { ctx.cue("Up yours! You're out of here, Mr. Frog. This guy is not even a good actor."); ctx.react('frogKicked'); }
      else { ctx.cue('Give it up for Mr. Frog, huh!'); ctx.crowd('applause', 0.8); }
    }
  }

  carEvent(type) {
    const ctx = this.ctx;
    if (type === 'enter') { ctx.ticker('A vintage roadster rolls onto the stage'); ctx.crowd('cheer', 0.8); }
    if (type === 'honk') ctx.ticker('A-OO-GAH!');
    if (type === 'gone') ctx.ticker('The roadster drives off');
  }
}
