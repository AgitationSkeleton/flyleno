// The Grey Leno Show, as a running order. Each episode opens with the greeting, runs a few segments drawn
// from Vinny's Grey Leno appearances (the 2022 Nightmare Puppeteer show, the VR / public-access / VHS
// follow-ups, the candidacy speech), and ends with the UFO sign-off. Every segment is a set of stimuli for
// the fly (sounds it hears, light and screen pictures it sees, touch, looming, fictive drives) plus crowd
// reactions that reach its dopamine neurons. The host's lines appear on cue cards: the fly can't read them,
// so Leno says whatever his articulator neurons produce.
import * as THREE from 'three';
import { Frog } from './frog.js';
import { Car } from './car.js';
import { FollowSpot, BandStand, DiscoLights, Confetti, Balloons, Ufo } from './props.js';
import { makeCard } from './cards.js';

const pick = (a) => a[(Math.random() * a.length) | 0];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

// syllable formants (F1, F2) for crowd chants
const V = { EY: [480, 1900], EH: [560, 1750], OW: [520, 900], AE: [700, 1700], IH: [420, 2000] };

export const SEGMENTS = {
  open: { title: 'Opening', dur: 16 },
  clip: { title: '"Take a look at this next one"', dur: 32 },
  guest: { title: 'Guest: Mr. Frog', dur: 60 },
  drive: { title: 'Sunday drive', dur: 55 },
  johnny: { title: '"Take it away, Johnny!"', dur: 13 },
  sponsor: { title: 'A word from our sponsor', dur: 14 },
  static: { title: 'Technical difficulties', dur: 11 },
  callin: { title: 'Call-in', dur: 16 },
  telethon: { title: 'Space scabies telethon', dur: 24 },
  dance: { title: 'Grey Leno dance party', dur: 22 },
  rally: { title: 'Vote Leno', dur: 32 },
  eclair: { title: 'The rotten éclair', dur: 30 },
  signoff: { title: 'Sign-off (UFO)', dur: 26 },
};
const MIDDLE = ['clip', 'guest', 'drive', 'johnny', 'sponsor', 'static', 'callin', 'telethon', 'dance', 'rally', 'eclair'];

const CALLS = [
  { q: 'Why do you puke so much?', a: "I don't puke, I'm frankly offended." },
  { q: 'Can you address the elephant in the room: who are the hooded chaps in the back?', a: "That's my staff." },
  { q: 'I really love how incredibly unfunny you are. Clone Orion is so much better.', a: 'Clone Orion is a two-bit hack, I\'m the best. Up yours, huh!' },
  { q: 'Tell me, what do you drive?', a: "I drive a UFO, huh. Beautiful. Beautiful." },
  { q: 'Is it true you are 500 years old?', a: "I'm 500 years young, folks." },
];

export class Show {
  /**
   * ctx: { scene, stage, audio, sfx, screens, npcs, getHost, isFly, hostPos, hostHead, impulse, backflip,
   *        stimAlias, pulse, reinforce, setStim, crowd, react, ticker, cue, motor, duckMusic, voice, mouthOpen,
   *        deliverSnack, onChange }
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
    this.episode = 0;
    this.rundown = [];
    this.idx = -1;
    this.cur = null;                 // { key, t, s (segment state) }
    this.gap = 6;
    this.light = 0;                  // extra light on the host's eyes this frame (0..1)
  }

  get active() { return !!this.cur; }

  newEpisode() {
    this.episode++;
    this.rundown = ['open', ...shuffle([...MIDDLE]).slice(0, 5), 'signoff'];
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
    this.gap = 8 + Math.random() * 10;
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
        this.idx++;
        this.run(this.rundown[this.idx]);
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
      // lift him a few metres and hold him there (about his own weight at the top) until the beam lets go
      const room = THREE.MathUtils.clamp((this.floorY + 5.5 - head.y) / 1.5, 0, 1);
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
    if (key === 'guest') ctx.cue("We're gonna have a guest, Mr. Frog. Mr. Frog will be on… at some point.");
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
    if (key === 'callin') { this.ctx.sfx.sting('ring', { gain: 0.8 }); s.call = pick(CALLS); ctx.cue("Caller number one, you're on the air."); }
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
    if (key === 'eclair') {
      ctx.cue('Mmm. An éclair, huh? Beautiful.');
      s.ok = ctx.deliverSnack('eclair');
    }
    if (key === 'signoff') {
      ctx.cue("Anyway, that's all the time we have for today. This is Grey Leno signing out.");
      ctx.crowd('applause', 1);
    }
  }

  step(key, s, t, dt, C) {
    const ctx = this.ctx;
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
    if (key === 'callin') {
      this.at(C, 3.2, () => { this.ctx.sfx.sting('caller', { gain: 0.8 }); ctx.ticker(`Caller: "${s.call.q}"`); });
      this.at(C, 7.5, () => ctx.cue(s.call.a));
      this.at(C, 12, () => ctx.crowd(Math.random() < 0.6 ? 'laugh' : 'applause', 0.8));
      return t > SEGMENTS.callin.dur;
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
    if (key === 'clip' && !s.back && ctx.screens?.available && s.prevMode && s.prevMode !== 'video') ctx.screens.setMode(s.prevMode);
    if (key === 'guest') this.frog.leave('done');
    if (key === 'drive' && this.car.present) this.car.active.phase = 'out';
    if (key === 'johnny' && s.ducked) ctx.duckMusic(1);
    if (key === 'dance') { this.disco.stop(); s.beat?.stop(); ctx.setStim('turnL', false); ctx.setStim('turnR', false); ctx.crowd('cheer', 0.8); }
    if (key === 'signoff') { s.hum?.stop(); if (this.ufo.state !== 'off') this.ufo.state = 'leave'; }
    if (['open', 'johnny', 'guest'].includes(key)) this.spot.off();
    if (['sponsor', 'static', 'telethon', 'rally', 'open'].includes(key)) ctx.screens?.clearCard();
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
