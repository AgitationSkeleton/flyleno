# FlyLeno: TUURD Talk, hosted by a fruit fly

**Live:** https://flyleno.viosarcade.xyz/

A browser simulation in which a **whole-brain spiking model of the adult fruit fly** (*Drosophila
melanogaster*, FlyWire v783, 138,639 neurons, 15.1M connections) runs live and puppeteers **Grey Leno**
on a TUURD-Talk-style stage.

What each part of the show does to the fly's brain:
- **Show events** (applause, a stagehand with a sugar cube, a heckler, thrown tomatoes and metal pipes)
  stimulate its sensory neurons.
- **The music** (a YouTube playlist) is fed into its auditory neurons.
- **The audience** reacts to what Leno does, which reaches the brain's dopamine neurons, which shape
  what it learns and chooses.

What the fly's neurons drive in return:
- Leno's physics-ragdoll muscles.
- His babbling voice, lip-synced.
- Retching, vomiting, farting.
- Fly-like grooming and feeding.

A **Fly-Leno** toggle turns him into a giant fruit fly with Leno's head, which walks and flies.

It is a static site with no build step: three.js and Rapier load from a CDN, and the brain runs in a Web Worker.

## Running locally

```bash
# everything the page needs is in the repo; these only regenerate the assets from their sources
blender -b assets/_src/leno/DAD_Leno.blend --python tools/export_leno.py -- assets/grey_leno.glb   # + grey_leno_head.glb
python tools/audio/run_pipeline.sh     # Leno voice/SFX bank from the two Vinesauce videos (venv, GPU); see tools/audio/README.md
python tools/audio/s09_extra_sfx.py    # boo / cheer / vomit / gag / goose-honk sound effects (YouTube SFX uploads)
python tools/export_tuurd_stage.py     # optional, not in git: the original game stage (?stage=game)

python tools/serve.py                  # no-cache dev server (module workers need http://)
# open http://localhost:8123/   (not 127.0.0.1: YouTube refuses embeds on bare-IP origins; the page redirects)
```

Useful URL options:
- `?form=fly`: start as Fly-Leno.
- `?body=kinematic`: use the old animated puppet instead of the ragdoll.
- `?stage=game`: load the exported game stage instead of the original one.
- `?lite`: no stage point lights.
- `?synth=1`: use synthesised placeholder sounds where the bank has none.

**Sound audition:** `http://localhost:8123/tools/audition.html` plays every clip in the bank. Untick
the ones that sound wrong: the choice is saved in the browser and the show skips them immediately.

## What drives what

Each item is marked **neural** (goes through the connectome model) or **engineered** (a layer outside
the connectome, labelled as such in the sidebar).

| Leno does | Driven by | Kind |
|---|---|---|
| walk / turn / back up | P9 + oDN1 / DNa01−02 left−right / MDN descending neurons | neural |
| individual limb muscles (46) | pools of the remaining ~1,250 descending neurons, one pool per muscle | neural |
| coordinated gait | "VNC" pattern generator (the fly's nerve cord isn't in the brain connectome) | engineered |
| staying upright | "puppet strings" (support slider); at 0 he is a pure ragdoll | engineered |
| startle jump | giant fiber (DNp01) | neural |
| grooming: hand rubbing (mild) / face wiping (strong) | aDN1 (antennal grooming DN) | neural |
| voice: babble, mutters, stammers | song/flight DNs DNg02+DNp13 (voicing) + pharyngeal (vowels) and mouthpart (consonants) motor neurons | neural, phoneme mapping engineered |
| lip-sync | loudness of Leno's own sounds → `MouthOpen` shape key (jaw drop) | — |
| retch / vomit | pharyngeal-pump motor neurons (PhN, not MN9) while MN9 is quiet; repeated retching → vomit | neural |
| fart | oviposition DNs (oviDN) | neural |
| eating | touching food → all 129 sugar taste neurons → the model's MN9 (proboscis motor neuron) decides | neural |
| walking toward food when hungry | food taxis | engineered (see below) |
| homing to his starting mark | he roams freely within ~4.5 m of his mark. Farther out, homesickness builds slowly (minutes; faster the farther away), and when it's full (or on a whim, about every 5 minutes) he makes a trip home: a home vector (path integration, which real flies do in the central complex, not modelled here) drives the brain's own DNa01/02 steering and P9 walking neurons until he's back near the mark. The ragdoll is also led gently by its strings, since its own walking is weak | engineered input onto neural DNs |
| sleeping | sleep pressure builds while he's awake (faster when tired); when it's high and he's safe he dozes off (see **Sleep** below) | engineered |
| saccadic turns, walking in bouts | shaping of the turn/walk commands | engineered |
| spontaneous actions | action selector ("initiative"): softmax over values learned from dopamine | engineered, driven by neural dopamine |
| Fly-Leno flight | DNg02/DNp13 wing power; giant-fiber escape take-off | neural |

**First-person cameras** (Eyes / Fly eyes buttons, `js/eyeview.js`), for both Leno and Fly-Leno:
- **Eyes:** from between Leno's eyes, with a human's ~110° field of view.
- **Fly eyes:** what the fly's compound eyes take in: a ~320° panorama (a blind wedge straight behind), resolved
  into hexagonal facets of ~5° (Drosophila has ~780 ommatidia per eye), and weak in red, so the red set looks
  dark. Rendered from a small cube map at the eye.
- **The head:** the camera sits inside the head. Humanoid Leno is drawn single-sided for the eye view (his head's
  surfaces face away from the camera and aren't drawn, his body still is); Fly-Leno's head and antennae are
  hidden for it. The live cams still show them.

**View** (bottom right of the 3D view): ▥ hides the sidebar; ⛶ fullscreen hides the sidebar and goes
browser-fullscreen where the browser allows; 👁 hides the overlay buttons (the three stay, faded). Keys: S, F, H.

**Speech:** the "speech" switch in the Voice panel turns his babbling off (the voice neurons still fire; nothing
is said).

**Stage screens** (viewport buttons: 📹 Cams / ▶ YouTube / 🟩 Green; YouTube link box in the sidebar):
- **Cams:** live cameras following Leno.
- **YouTube:** any YouTube video on the big backdrop screen. The real iframe is placed in 3D behind a
  transparent hole in the WebGL canvas, so objects in front occlude it.
- **Green:** a lime full-bright green screen.

The fly **sees** the big screen: its left and right halves (brightness + frame-to-frame motion),
weighted by whether the screen is in Leno's field of view, drive 400 sampled R1-6 photoreceptors per
eye. For a YouTube video that needs "pipe tab audio", whose tab capture also carries the picture;
browsers don't expose iframe pixels otherwise. The video's sound reaches the fly's ears the same way.

**The goose** (`js/goose.js`): at random intervals (every ~1–3 minutes, on its own schedule) a
low-poly goose waddles onto the stage. It honks (YouTube SFX) and defecates profusely. The droppings
are food: humanoid Leno ignores them, but Fly-Leno seeks them out even when barely hungry, tastes them
(sugar neurons → MN9) and eats them.

**Predators** (`js/predators.js`, engineered; random visits like the goose, never lethal, off with `?quiet`):
- **Spider-Leno** (rare, every ~4–9 minutes): a spider with Leno's head rappels from the ceiling on a
  silk thread. Its anchor creeps along the ceiling to stay above the host. It dangles and lunges.
  - **Grab:** 60% of close lunges grab him. It reels him up the thread for 3–4.5 s, and the audience
    gasps. Fly-Leno is held by the thorax.
  - **Miss:** it bumps him instead.
  - **Leaving:** it climbs back up after ~40–50 s.
- **The glove** (every ~1.5–4 minutes): a floating white cartoon glove with a fly swatter. It hovers,
  winds up and swats where he'll be. A hit knocks him around; a miss slaps the air.
  - **Electric racket:** one visit in four is a bug-zapper racket instead. A hit zaps him: arcs,
    crackle, twitching. The arcs glow steadily and fade (no flicker).
  - **Leaving:** it floats off after ~25 s.
- **What the fly gets:**
  - The descent, the lunges and the wind-up are looming objects (LC4). The giant fibre often makes him
    jump away from the swing.
  - Hits, grabs and zaps drive mechanosensory neurons and punishment dopamine. Zaps also drive the
    antennal JO.

**Happenings** (`js/happenings.js`, engineered; random, off with `?quiet`):
- **The Rapture** (rare: the first after ~5–10 minutes, then every ~10–20): a trumpet sounds and a light column comes down.
  - **Ascension:** every seated audience member (not Leno) rises spinning into the light and is gone.
  - **Empty house:** then the seats stay empty for 30–45 s. Nobody reacts, cheers, boos, throws or heckles.
  - **Babies:** the seats fill with baby cultists (small, big-headed, standing on their seats, crying).
    They grow back into their adult selves over about 100 seconds.
  - **Effects:** the light reaches the fly's eyes, and the crowd reacts less while it is young.
- **Rain cloud:** a personal storm cloud follows Leno and rains on him.
  - **Rain:** water on the body and antennae (mechanosensory and JO → grooming), plus punishment dopamine
    every 2 s while he's under it. Rain also rinses off some grime.
  - **Lightning:** strikes toward him with thunder and one flash that fades (it hits the floor instead if he has
    outrun the cloud).
  - **Leaving:** it drifts off after 35–50 s.
- **Vinesauce mushroom:** a power-up styled on the Vinesauce logo: green dome (yellow-green to teal) with white spots and a white badge with a teal V, on a white stem with green eyes and a smile.
  It slides slowly for a few seconds, then settles, and it stops whenever he comes close. Eating it corrupts
  the picture for 5 s like a bad NES cartridge: NES-palette pixels, swapped and garbage tiles, torn scanlines,
  hue shifts and a chiptune garble; the fly's photoreceptors see it too. It is kept photosensitivity-safe: no
  flicker frames, hue shifts keep the brightness, and the corruption changes about twice a second.
  - It falls from the ceiling and slides about the stage.
  - Leno goes for it even when not hungry. Eating it gives a big 3.5 s dopamine reward, a power-up
    sound and cheers.
- **Rig failure:** studio cameras and stage lights break loose from the ceiling. They are physics objects:
  - Falling toward him drives LC4 looming. The light's glass shatters.
  - A hit is touch plus strong punishment dopamine, and the audience gasps.
- **Throwing storms:** now and then the audience unleashes a barrage of 14–30 tomatoes and pipes over a few
  seconds.
- **Roses:** single roses are thrown now and then (also the 🌹 button), and sometimes a whole rose storm.
  A rose that lands on Leno is a compliment: a little touch and reward dopamine, and cheers. Roses weigh 50 g
  and are tossed in a slow arc to his chest or his feet, never at his face: no knockback, no injury, and they
  don't set off the looming alarm (a pipe or tomato flying at his head does).
- **Sugar cubes:** now and then someone lobs a sugar cube (also the 🧊 button). It's aimed at the floor just in
  front of him, weighs almost nothing and can't hurt or shove him; once it comes to rest it is food he can eat.
  When he's starving the audience sometimes lobs a handful.
- **Kindness:** single roses and sugar cubes come sooner when he's having a hard time: sugar when he's hungry,
  a rose when his morale is low or he's stressed.
- **Standing ovation:** the whole audience stands and applauds for 7–12 s, with a long reward.
- **Mini aliens** (every ~4–8 minutes): 24–40 little grey aliens march in, surround Leno and kick him in the shins.
  - A kick knocks the leg and him around, with touch and mild punishment.
  - Sounds: while they're active, `TOES.mp3` and `mimimi.mp3` play at random from the crowd of them (boosted
    ~12 dB: the recordings are much quieter than the rest of the bank). Every kick that lands plays
    `go_alert2.wav`. All three are in `assets/audio/sfx/minialien/`.
  - They scatter after 30–40 s.

**Events panel and Peaceful Mode** (`js/events.js`):
- **Switches:** the Events panel in the sidebar has an on/off switch for every event: visitors and predators
  (goose, spider-Leno, swatter, electric racket, mini aliens, Mr. Frog's tongue, the car nudging him),
  happenings (Rapture, rain cloud, mushroom, falling rig), every kind of audience action (cheers/laughs/applause,
  gasps, boos, rose / sugar / tomato / pipe throws, rose storms, tomato-and-pipe storms, ovations, hecklers), the
  stage crew and director's cues (stagehand snacks, rotten éclairs, applause cues, walk drives, the bitter-taste
  cue), and each show segment. Harmful ones have a red dot. The switches are remembered in this browser.
- **Peaceful Mode:** one switch that turns off everything harmful (anything that hits, grabs, soaks, zaps or
  punishes the fly) and greys it out: the harmful switches, the tomato and pipe buttons, harmful segments, the
  aversive "Show events" stimuli and the brain worms. Switched on mid-show, the harmful things leave at once (the
  spider climbs away, the glove floats off, the rain cloud drifts away, the aliens scatter). Mr. Frog keeps his
  tongue in, the car steers around Leno instead of nudging him, and the UFO's beam only lifts him a little.
- **Overlap:** the Rapture, the rain cloud and the mini aliens don't start while one of the others is on (one
  that's blocked tries again 20–40 s later), and spider-Leno and the glove don't visit at the same time.
  Everything else runs on its own timer.

**Sleep** (`js/sleep.js`, engineered, "sleep" in Brain settings):
- **Pressure:** builds while he's awake (base ~6 minutes to full, faster when his energy is low, much faster
  during the lullaby) and drains while he sleeps.
- **Dozing off:** when it's high and he's safe (nothing looming, not frightened, held, eating, falling or being
  knocked about) he settles for a few seconds and falls asleep. Humanoid Leno kneels and curls forward with his
  head down (the strings lower him); Fly-Leno sinks low on folded legs with its head bowed. "Z"s float up.
- **Asleep:** his eyes are shut (the photoreceptor drive from what he sees fades out), hearing is turned down to
  ~40% and the touch/taste ambience halved (sensory gating), he doesn't talk, retch or vomit, his own initiative
  rests, and the body recovers: energy comes back fast, injuries heal about three times faster, stress and
  dizziness fade quickly, hunger grows slower. The show and its events carry on around him (and can wake him).
- **Waking:** a hit, touch, sudden loud noise or something looming wakes him (easily in light sleep, less easily
  once he's deep asleep), and he wakes by himself when rested. Getting up off the floor afterwards isn't a fall.

**Knockbacks:** a hit (swatter, spider, zap, alien kick, pipe or falling rig, the car, a backflip) makes the
puppet strings go slack for a moment, so he really is knocked over; they tighten again over about a second.
Fly-Leno is thrown into a short uncontrolled tumble instead (its walking and flight control would otherwise cancel
the push), and thrown or falling objects hand it their momentum.

**Falls:** Leno stays in whatever pose he lands in; nothing snaps him upright. After ~4 s on the
floor, the puppet strings help him up gradually, physically. He is put back on stage only if he has
left the set. Dangling in a predator's grip, eating on all fours, or sleeping curled up doesn't count as a fall.

**Audience levels of detail** (`js/cultists.js`): each seated cultist is drawn at one of three levels by its
distance from the viewing camera, with 10% hysteresis so seats don't flicker:
- **Near** (under 16 m): the full figure, 1,076 triangles, with a head that follows Leno.
- **Mid** (16–32 m): about half the segments, 364 triangles; the head still follows Leno.
- **Far** (over 32 m): one merged piece of 104 triangles (robe, hood, white mask), with the head fixed.

**Other levels of detail** (`js/lod.js`):
- **Instanced set pieces:** seats, toilets, truss bays and light cans each get one or two simpler geometries and
  are re-bucketed by camera distance whenever the camera moves:
  - seats: 516 → 36 → 24 fabric triangles (every level keeps the black back shell, so the seat backs don't change
    colour with distance); toilets: coarse lathe and boxes; truss: just the four chords far away;
    light cans: 8 instead of 20 segments.
- **One-off props:** the frog, car, goose, stagehand/heckler, spider, glove, mushroom, bandstand, balloons, UFO
  and the mini aliens swap each mesh to automatically simplified copies (three.js `SimplifyModifier`) as they get
  small on screen: full, then medium (~60% of the vertices), then far (~25%).
  - The goose keeps 80% and 45%, because its round body crumples otherwise.
  - The frog's eyes are their own mesh and are never simplified.
- **Effect:** about 30–45% fewer triangles from the default cameras.

**Hecklers:** a heckler charges the stage, then either rants with both arms raised or pelts Leno with
3–5 tomatoes and pipes thrown from its hand (only the kinds whose switches are on).

**Eating posture:** humanoid Leno kneels and goes down onto his forearms with his face to the food (mouth ~0.25 m
off the floor). The puppet strings lower him all the way, lean him forward and let go of his head, so they never
hold him up out of the posture at any support setting. Fly-Leno lowers its head to the food. Sleeping works the
same way: the strings lower him into a curl, forehead to the floor.

`?quiet` starts the page with autopilot, initiative, goose visits and the show rundown off.

**The Grey Leno Show** (`js/show.js`, engineered): with autopilot on, the show runs in episodes.
- **Structure:** each episode opens with the greeting, runs five segments, and ends with the sign-off. The
  segments come from Vinny's Grey Leno appearances: the 2022 Nightmare Puppeteer show, the later VR,
  public-access and VHS episodes, and the candidacy speech.
- **Rundown:** an episode alternates calm segments (talk, screens) with busy ones (a guest, a party) and takes
  the segments that have gone longest without a run, so every segment comes round within a few episodes. The
  lullaby closes about one episode in three (at least every third). 8–18 s between segments, 20–35 s between
  episodes. Segments that need a stagehand wait for one to be free.
- **Controls:** the "Tonight's show" panel lists the rundown and has a button for every segment. A
  segment holds the director's random events while it runs. Each segment also has a switch in the Events panel.
- **No script on screen:** the host's lines from the shows are kept in `js/show.js` as cue cards, but
  they are not displayed (commented out in `cue()` in `js/main.js`). The fly brain does the talking:
  Leno says whatever his articulator neurons produce, and only the segment's events happen. Nothing makes him
  talk: where a segment wants something from him (the phone-in, the monologue) it gives him the floor and listens,
  and whatever he says on his own is quoted.
- **No flashing:** lights fade, screens move smoothly, the wheel's colours share one brightness, and the static
  is a soft grey snow redrawn ~12 times a second.

| Segment | What happens | What the fly gets |
|---|---|---|
| Opening | "Hey everybody and welcome to the Grey Leno Show!" title card; "Today we have a show." gets applause for nothing; a "GREY LE-NO" chant | sound (JO), screen picture (R1-6), reward dopamine from the crowd |
| Guest: Mr. Frog | a frog hops to the guest spot, answers every question with "Good. Good. Good." (croaks), and flicks his tongue at the host. He can catch and spit out Fly-Leno. He leaves when Leno bites his ankles (mouth open right next to him), shouts him off ("Up yours! You're out of here, Mr. Frog"), or his time is up | croaks (JO); tongue = looming (LC4) + hit (mechanosensory, punishment); the crowd reacts |
| Sunday drive | a vintage roadster laps the stage, brakes and honks "a-oo-gah" when Leno is in the way ("do you drive a car?") | engine rumble (JO-B), floor vibration (mechanosensory), headlights approaching (LC4) |
| Take it away, Johnny! | a spotlight swings to the empty band stool; the music drops out, crickets; "Where's Johnny?"; rimshot | sudden silence, crickets (JO-A), spotlight on the eyes |
| A word from our sponsor | GRONK sponsor card (a slow, throbbing glow; no strobe), then "Buy Grey Leno NFTs" | pulsing light on the eyes (R1-6) |
| Technical difficulties | screens full of soft grey static; "Dave, can you fix the static?" | visual noise (R1-6), hiss (JO-A) |
| Phone-in | the desk phone rings and a garbled caller asks e.g. "Why do you puke so much?" or "What do the worms in your brain tell you?" (shown in the ticker). Then the line goes quiet for up to 9 s: whatever Leno says on his own is quoted as his answer (nothing drives his voice). Silence gets crickets and the caller hangs up | ring and voice (JO); laughs/applause or silence |
| Monologue | spotlight; three "jokes": he has the floor for up to 8 s each, and nothing makes him talk. When he has said something and stops, a rimshot and usually a laugh (his words are quoted); if he says nothing, crickets ("tough crowd") | spotlight (R1-6), rimshots (JO), reward for talking |
| Guest: a goose | "Our next guest… a goose!" The goose waddles on in a follow spot, honks and poops | honks (JO), a spotlit mover (LC4, R1-6), droppings for Fly-Leno |
| 500 years young | "I'm 500 years young, folks": a stagehand carries out a birthday cake with candles, the crowd sings Happy Birthday, balloons and confetti. The cake is food he goes for even when not hungry | the song and applause (JO), sugar taste, reward |
| The Leno Wave | the audience does a stadium wave three times round, chanting "LE-NO" | a wave of motion across the seats (R1-6), chant (JO), cheers |
| Spin the Wheel of Leno | a prize wheel on the screens spins (at most ~1 turn a second, soft colours) and lands on a prize: a sugar shower, roses, an ovation, confetti, a goose, a mushroom, nothing, or (only when tomato storms are on) tomatoes | moving picture (R1-6), clicks (JO), then the prize |
| Lullaby | the studio lights fade down to about half, a music-box lullaby (Brahms) plays, the music ducks and the audience hushes; sleep pressure builds fast, and if he nods off there's a soft "aww". The lights fade back up at the end | dim light (R1-6), soft music (JO), sleep |
| Space scabies telethon | telethon card with a donation counter ("three out of four Martians have the same problem") | itching: bursts on the mechanosensory and antennal JO neurons (→ grooming) |
| Grey Leno dance party | disco lights and strobe, a synthesised beat; "my body is moving on its own": fictive left/right turning drives on the beat | beat (JO), strobe (R1-6), DNa01/02 fictive drives |
| Vote Leno | campaign card, confetti and balloon drop, "LE-NO!" chant; "Folks, I can do a backflip": the backflip happens only if the giant fibre fires within 9 s, otherwise no backflip and boos | confetti landing on him (JO + touch, like dust → grooming); cheers or boos (dopamine) |
| The rotten éclair | a stagehand brings an éclair. It's sweet (sugar neurons) and bitter (bitter neurons); after eating it the pharyngeal motor neurons are driven, so the model's own retch/vomit readout usually brings it back up ("it's the rotten éclair again") | taste, then punishment dopamine |
| Sign-off | "…drive your car home safe, I'm gonna get my UFO": a flying saucer comes down, its tractor beam lifts Leno a few metres (in Peaceful Mode only a little), then it flies off | UFO hum (JO), beam light (R1-6), looming saucer (LC4) |

The director's random stagehand also brings the rotten éclair instead of a sugar cube one time in four
(when rotten éclairs are switched on).

**Brain worms** (Brain settings, off by default, engineered): "The worms in my brain only eat the cells
I don't need, like policies" (candidacy speech).
- **Eating:** worms silence about 150 neurons per second. They only take neurons that are not sensory,
  motor or readout neurons and have been quiet for at least 0.5 s. An eaten neuron never fires and
  ignores its inputs.
- **Neural map:** eaten cells turn dark red, and pink worms crawl to each new meal.
- **Limits:** they stop at 35% of the brain. Eaten cells stay eaten through a brain reset until you
  press "heal".

**Spontaneous runaway:** with adaptation off (the default pure Shiu model), the network ignites into
its self-sustained ~900k spikes/s state every so often, even at idle. The runaway guard resets it
after 2.5 s, shown as a commercial break during the show.

**Eggs and hatchlings** (`js/brood.js`, engineered):
- **Laying:** each time Leno reaches a new surface (floor, a platform step, the platform top, or a
  landing after flight) there is a 5% chance he squats and lays a Drosophila-style egg: white, with two
  respiratory filaments. The chance is adjustable in Brain settings.
- **Hatching:** after 12–22 s the egg wobbles and hatches into a mini Leno, randomly humanoid or
  fly-form.
- **Hatchlings:** they wander in fly-like bouts near where they hatched, return toward their parent
  when it is far away, chirp in a sped-up Leno voice, and fly-form ones flutter. Up to 16 hatchlings; each one
  leaves the show after 3–5 minutes.
- **Brain:** hatchlings run on simple autonomous behaviour; only the host is driven by the fly brain.

**Senses:**
- **Hearing:** in-world sound drives the fly's auditory JO-B (low band) and JO-A (high band) neurons, with
  onsets adding bursts. With "pipe tab audio" (tab capture, which shows the browser's sharing bar) that
  includes the real waveform of the YouTube music; otherwise the page's own sounds plus a
  volume-based estimate of the music.
- **Eyesight:** a few times a second two tiny wide cameras at Leno's eyes (one per compound eye, 150° each,
  ~300° together) render the scene, and each eye's brightness and motion drive its 400 sampled R1-6
  photoreceptors. So the brain sees everything: the stage, the crowd, whatever approaches or darkens the view.
  The stage-screen vision then only adds a YouTube video from tab capture, which WebGL can't see. It can be
  turned off in Brain settings.
- **Looming:** every moving thing drives the LC4 looming neurons by how fast its angular size grows, each one
  tracked on its own: stagehands and hecklers, the goose, Mr. Frog and his tongue, the roadster, the UFO,
  spider-Leno and the swatter glove, mini aliens, a falling mushroom, balloons, hatchlings, the rain cloud and
  every thrown or falling object.
- **Contact:** bumping into anything solid (stagehands, the goose, the frog, hatchlings, aliens) and falling over
  drive mechanosensory neurons.
- **Light:** the follow spot, disco strobe and tractor beam falling on Leno add drive to the R1-6
  photoreceptors of both eyes, on top of what the stage screens show.
- **Touch and taste:** tomato hits drive bitter taste and mechanosensory neurons (a tomato that misses
  him lands as pulp on the floor or stage below where it burst), pipe hits drive
  mechanosensory neurons plus punishment dopamine, and occasional "dust" on the antennae drives JO.
- **Ambience:** low-rate noise on taste and touch neurons.

**State of mind and body** (Mind panel, `js/wellbeing.js`): read-outs, not drives. Every bad state has a way
back, and each row says what it is:
- **Condition:** a one-line summary, e.g. "on his feet; bruised, damp, frightened" or "fast asleep; tired".
- **State of mind:**
  - Arousal (overall firing).
  - Stress: builds with threats, hits and punishment dopamine; fades when he's safe, much faster asleep, and
    praise (reward) calms him.
  - Fear: follows the looming detectors and startles; fades when nothing threatens him.
  - Morale: slow dopamine mood; applause, roses and food lift it.
  - Hunger (a meal fixes it), nausea (passes), homesickness (a trip home fixes it), sleepiness (sleep clears it),
    and dizziness (from knocks, tumbles and the glitch; wears off).
- **Body:**
  - Health: injuries from hits, zaps, kicks, falls and the rig; heals slowly, faster at rest, fastest asleep.
  - Energy: used by walking, flying and struggling; restored by food and rest, and fast by sleep.
  - Wetness: rain, drying off.
  - Grime: splats and slime, cleaned by grooming (and rinsed by rain).
- **Brain health:** load against the runaway threshold (lower asleep), recent runaway resets, and cells lost to
  brain worms (the heal button restores them; Peaceful Mode turns the worms off).

**Learning:**
- **Crowd reactions:** these are reinforcement. Cheers, laughs and applause stimulate PAM (reward)
  dopamine neurons; boos and gasps stimulate PPL1 (punishment).
- **Dopamine signal:** the worker measures the model's own PAM − PPL1 activity and turns it into a
  dopamine signal.
- **Synapse changes:** that signal gates plasticity on all 11,419 synapses onto the articulator motor
  neurons, so rewarded vocalisations become more likely.
- **Action choice:** the same dopamine updates the action selector's values. Bad mood makes choices
  more exploratory.
- **Teach a word:** a stagehand repeats the word and rewards matching syllables.

## The brain

This is a leaky integrate-and-fire network after **Shiu et al. 2024**
([philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model), MIT), with the
same parameters:
- v₀ = −52 mV, v_th = −45 mV
- τ_m = 20 ms, τ_syn = 5 ms
- refractory period 2.2 ms, synaptic delay 1.8 ms
- 0.275 mV per synapse
- dt = 0.1 ms

Integration is exact and **lazy**: a neuron is stepped only while an upper bound on its voltage
peak can still reach threshold. That keeps the whole network at about real time in JavaScript.
`tools/reference_sim.py` (brute-force NumPy) reproduces its results.

Additions (each can be toggled in Brain settings):
- **Spike-frequency adaptation (off by default; turn on in Brain settings for a calmer brain):** each spike raises that neuron's threshold by 1 mV,
  decaying with τ = 150 ms. The published model tips into self-sustained runaway activity under broad
  or recurrent input: Or56a, PPL1, any olfactory receptor input, and mechanosensory noise. Adaptation
  contains most of that while keeping the classic responses:

  | Stimulus | Response with adaptation |
  |---|---|
  | sugar | MN9 40–60 Hz |
  | LC4 | giant fiber ~110 Hz |
  | JO | aDN1 grooming ~25 Hz |

- **Runaway guard:** if activity stays above 150k spikes/s for 2.5 s of real time, the brain is reset. Without
  adaptation runaways are more frequent, so expect more of these resets. With
  autopilot on, this is announced as a "commercial break".
- **Dopamine-gated plasticity:** see "Learning" above.

**Olfaction is unusable in this model:** stimulating fruit-odour receptor neurons (DM1–4, VA2) on
either side at any rate down to 8 Hz ignites the runaway, and turning-neuron output is then
right-biased regardless of side. Food finding is therefore an engineered taxis. Taste and feeding go
through the model.

## Layout

| Path | What |
|---|---|
| `js/brain-worker.js` | LIF engine, plasticity, adaptation (Web Worker) |
| `js/main.js` | wiring: scene, brain messages, UI, loop |
| `js/body.js`, `js/ragdoll.js`, `js/vnc.js` | active ragdoll (Rapier), muscle model, gait generator (`docs/ragdoll.md`) |
| `js/flybody.js` | Fly-Leno body: six-legged gait, wings/flight, proboscis, grooming |
| `js/leno.js` | Leno loader, lip-sync rig, kinematic fallback |
| `js/instincts.js`, `js/food.js` | fly instincts: feeding, taxis, saccades, bouts, dust grooming |
| `js/behavior.js` | voice (phonemes from motor neurons), retch/vomit/fart |
| `js/audience.js`, `js/cultists.js`, `js/cultist-model.js`, `js/npcs.js` | crowd reactions, hooded masked audience, stagehand + heckler |
| `js/mind.js` | mood + action selection |
| `js/audio.js`, `js/hearing.js`, `js/youtube.js` | sound bank + lip-sync analyser, the fly's ears, music player |
| `js/projectiles.js`, `js/fx.js` | tomatoes/pipes, vomit/fart/juice particles |
| `js/stage-original.js` | original procedural stage (`assets/original-stage-notes.md`) |
| `js/livecam.js`, `js/neuromap.js` | studio cameras on the screens, live neural map |
| `data/` | connectome (31 MB), neuron groups/params, soma positions (committed) |
| `tools/build_connectome.py`, `tools/neuron_groups.json`, `tools/body_spec.json` | brain data build |
| `tools/audio/` | sound-bank pipeline (Demucs, Whisper, ECAPA diarisation, AudioSet tagging, phoneme CTC) |
| `tools/export_leno.py` | Leno GLB + head GLB + `MouthOpen` shape key (Blender) |
| `tools/*-preview.html`, `tools/audition.html` | stage / ragdoll / figure previews, sound audition |

## Sounds

Most clips are cut from the two videos:
- **Leno's phonemes, syllables, mutters and words:** Leno's voice, identified by speaker
  clustering, from [w7lBVJwHABM](https://www.youtube.com/watch?v=w7lBVJwHABM) and
  [ki3ssj466E0](https://www.youtube.com/watch?v=ki3ssj466E0).
- **Farts, splats, gasps, laughs and applause:** found in those videos by AudioSet tagging.

The videos contain no clean booing, cheering or vomiting. The tagger's "retch" hits turned out to be
burps and are kept as `sfx/burp`. So those categories come from short YouTube sound-effect uploads:
- **Boos:** u0D718AmYTs, hJlxgWYqvR0, Dk3OZ4a9m6o.
- **Cheers:** barWV7RWkq0, Vw9MCNbFggI, JhE6hEgTth0.
- **Vomiting:** UnDhyWnHPD0, RgJ8wfuDfo4.
- **Gagging:** pf93OHsjkQM, A3wzIw1tWkw, jqHViajqnwc.
- **Pipe clang:** f8mL0_4GeV0.
- **Goose honks:** zcDiAD8RGq8, J0WO22NhTK8, A8nqfY3rUKw.

All clips are git-ignored.

## Deploying (GitHub Pages)

The site is published straight from the `main` branch root at **https://flyleno.viosarcade.xyz/** (a custom subdomain of viosarcade.xyz: `CNAME` file in the repo, DNS `CNAME flyleno → agitationskeleton.github.io`, DNS-only, HTTPS enforced; the page also upgrades http to https itself). There is no build step; `.nojekyll`
makes Pages serve every file as-is. Everything it loads is in the repo: the procedural stage, Leno's model,
the sound bank and the connectome data (`data/`, ~32 MB, decompressed in the browser). YouTube embeds and tab
capture both work there, since the site is served over HTTPS from a named origin.

Only the optional Nightmare Puppeteer game stage (`?stage=game`) and its backdrops are not in the repo.

## Credits

**Grey Leno model:** ported by huckleberrypie: [Grey Leno for Dead as Disco on Nexus Mods](https://www.nexusmods.com/deadasdisco/mods/917). The original character and model are by Vinesauce. Credit is also shown in the page footer and the About dialog.

## Asset licensing

| Asset | Owner / terms | In git? |
|---|---|---|
| Original TUURD-style stage, robed audience figures | written for this project (procedural geometry/textures; Droid Sans font, Apache-2.0) | yes |
| Game stage / backdrops (`?stage=game`) | *Nightmare Puppeteer*, © its developer | no |
| Grey Leno model | port by **huckleberrypie** (Nexus Mods: huckpie): [Grey Leno for Dead as Disco](https://www.nexusmods.com/deadasdisco/mods/917); original character/model by Vinesauce. Used in accordance with the mod's terms of use. | yes |
| Leno voice bank | cut from Vinesauce's [The Grey Leno Show](https://www.youtube.com/watch?v=ki3ssj466E0) and [Grey Leno announces his candidacy](https://www.youtube.com/watch?v=w7lBVJwHABM), with thanks to Vinesauce | yes |
| Crowd / effect sounds | cut from YouTube sound-effect uploads (sources in `assets/audio/manifest.json`); mini-alien clips in `assets/audio/sfx/minialien/` supplied for the project | yes |
| Connectome + LIF model | Shiu et al. 2024 (MIT); FlyWire v783 (Dorkenwald et al. 2024, Schlegel et al. 2024) | yes |
| Stimulus / motor neuron IDs | [erojasoficial-byte/fly-brain](https://github.com/erojasoficial-byte/fly-brain) (MIT) | yes |
