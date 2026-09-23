# FlyLeno: TUURD Talk, hosted by a fruit fly

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
# third-party assets (not in git, see "Asset licensing")
blender -b assets/_src/leno/DAD_Leno.blend --python tools/export_leno.py -- assets/grey_leno.glb   # + grey_leno_head.glb
python tools/audio/run_pipeline.sh     # Leno voice/SFX bank from the two Vinesauce videos (venv, GPU); see tools/audio/README.md
python tools/audio/s09_extra_sfx.py    # boo / cheer / vomit / gag / goose-honk sound effects (YouTube SFX uploads)
python tools/export_tuurd_stage.py     # optional: the original game stage (?stage=game)

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
| saccadic turns, walking in bouts | shaping of the turn/walk commands | engineered |
| spontaneous actions | action selector ("initiative"): softmax over values learned from dopamine | engineered, driven by neural dopamine |
| Fly-Leno flight | DNg02/DNp13 wing power; giant-fiber escape take-off | neural |

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

**Hecklers:** a heckler charges the stage, then either rants with both arms raised or pelts Leno with
3–5 tomatoes and pipes thrown from its hand.

**Eating posture:** humanoid Leno gets down on all fours to eat. The puppet strings lower him, lean
him forward over his hands and tip his pelvis. Fly-Leno lowers its head to the food.

`?quiet` starts the page with autopilot, initiative, goose visits and the show rundown off.

**The Grey Leno Show** (`js/show.js`, engineered): with autopilot on, the show runs in episodes.
- **Structure:** each episode opens with the greeting, runs five segments drawn at random, and ends
  with the sign-off. The segments come from Vinny's Grey Leno appearances: the 2022 Nightmare Puppeteer
  show, the later VR, public-access and VHS episodes, and the candidacy speech.
- **Controls:** the "Tonight's show" panel lists the rundown and has a button for every segment. A
  segment holds the director's random events while it runs.
- **No script on screen:** the host's lines from the shows are kept in `js/show.js` as cue cards, but
  they are not displayed (commented out in `cue()` in `js/main.js`). The fly brain does the talking:
  Leno says whatever his articulator neurons produce, and only the segment's events happen.

| Segment | What happens | What the fly gets |
|---|---|---|
| Opening | "Hey everybody and welcome to the Grey Leno Show!" title card; "Today we have a show." gets applause for nothing; a "GREY LE-NO" chant | sound (JO), screen picture (R1-6), reward dopamine from the crowd |
| Guest: Mr. Frog | a frog hops to the guest spot, answers every question with "Good. Good. Good." (croaks), and flicks his tongue at the host. He can catch and spit out Fly-Leno. He leaves when Leno bites his ankles (mouth open right next to him), shouts him off ("Up yours! You're out of here, Mr. Frog"), or his time is up | croaks (JO); tongue = looming (LC4) + hit (mechanosensory, punishment); the crowd reacts |
| Sunday drive | a vintage roadster laps the stage, brakes and honks "a-oo-gah" when Leno is in the way ("do you drive a car?") | engine rumble (JO-B), floor vibration (mechanosensory), headlights approaching (LC4) |
| Take it away, Johnny! | a spotlight swings to the empty band stool; the music drops out, crickets; "Where's Johnny?"; rimshot | sudden silence, crickets (JO-A), spotlight on the eyes |
| A word from our sponsor | GRONK sponsor card (strobing), then "Buy Grey Leno NFTs" | strong visual flicker (R1-6) |
| Technical difficulties | screens full of static; "Dave, can you fix the static?" | visual noise (R1-6), hiss (JO-A) |
| Call-in | phone rings, a garbled caller asks e.g. "Why do you puke so much?"; the answer is on a cue card | ring and voice (JO) |
| Space scabies telethon | telethon card with a donation counter ("three out of four Martians have the same problem") | itching: bursts on the mechanosensory and antennal JO neurons (→ grooming) |
| Grey Leno dance party | disco lights and strobe, a synthesised beat; "my body is moving on its own": fictive left/right turning drives on the beat | beat (JO), strobe (R1-6), DNa01/02 fictive drives |
| Vote Leno | campaign card, confetti and balloon drop, "LE-NO!" chant; "Folks, I can do a backflip": the backflip happens only if the giant fibre fires within 9 s, otherwise no backflip and boos | confetti landing on him (JO + touch, like dust → grooming); cheers or boos (dopamine) |
| The rotten éclair | a stagehand brings an éclair. It's sweet (sugar neurons) and bitter (bitter neurons); after eating it the pharyngeal motor neurons are driven, so the model's own retch/vomit readout usually brings it back up ("it's the rotten éclair again") | taste, then punishment dopamine |
| Sign-off | "…drive your car home safe, I'm gonna get my UFO": a flying saucer comes down, its tractor beam lifts Leno a few metres, then it flies off | UFO hum (JO), beam light (R1-6), looming saucer (LC4) |

The director's random stagehand also brings the rotten éclair instead of a sugar cube one time in four.

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
  when it is far away, chirp in a sped-up Leno voice, and fly-form ones flutter. Up to 16 hatchlings.
- **Brain:** hatchlings run on simple autonomous behaviour; only the host is driven by the fly brain.

**Senses:**
- **Hearing:** in-world sound drives the fly's auditory JO-B (low band) and JO-A (high band) neurons, with
  onsets adding bursts. With "pipe tab audio" (tab capture, which shows the browser's sharing bar) that
  includes the real waveform of the YouTube music; otherwise the page's own sounds plus a
  volume-based estimate of the music.
- **Looming:** approaching hecklers, thrown objects, Mr. Frog's tongue, the roadster and the arriving
  UFO drive LC4 looming neurons (expansion rate of their angular size).
- **Light:** the follow spot, disco strobe and tractor beam falling on Leno add drive to the R1-6
  photoreceptors of both eyes, on top of what the stage screens show.
- **Touch and taste:** tomato hits drive bitter taste and mechanosensory neurons, pipe hits drive
  mechanosensory neurons plus punishment dopamine, and occasional "dust" on the antennae drives JO.
- **Ambience:** low-rate noise on taste and touch neurons.

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
- **Vomiting:** UnDhyWnHPD0, RgJ8wfuDfo4, yoD5T0N1SzU.
- **Gagging:** pf93OHsjkQM, A3wzIw1tWkw, jqHViajqnwc.
- **Pipe clang:** f8mL0_4GeV0.
- **Goose honks:** zcDiAD8RGq8, J0WO22NhTK8, A8nqfY3rUKw.

All clips are git-ignored.

## Deploying (GitHub Pages)

The page is static. **Pages sites are public even for private repos** (outside Enterprise).

What works without the third-party assets:
- the original stage, the audience, the brain and the music;
- the sound bank is optional, and is silent without `?synth=1`.

What doesn't: Leno's model is required. Without the Leno GLBs the page shows a message.

## Credits

**Grey Leno model:** ported by huckleberrypie: [Grey Leno for Dead as Disco on Nexus Mods](https://www.nexusmods.com/deadasdisco/mods/917). The original character and model are by Vinesauce. Credit is also shown in the page footer and the About dialog.

## Asset licensing

| Asset | Owner / terms | In git? |
|---|---|---|
| Original TUURD-style stage, robed audience figures | written for this project (procedural geometry/textures; Droid Sans font, Apache-2.0) | yes |
| Game stage / backdrops (`?stage=game`) | *Nightmare Puppeteer*, © its developer | no |
| Grey Leno model | port by **huckleberrypie** (Nexus Mods: huckpie): [Grey Leno for Dead as Disco](https://www.nexusmods.com/deadasdisco/mods/917); original character/model by Vinesauce. Used in accordance with the mod's terms of use. | no |
| Leno voice/SFX bank | cut from Vinesauce videos and YouTube SFX uploads | no |
| Connectome + LIF model | Shiu et al. 2024 (MIT); FlyWire v783 (Dorkenwald et al. 2024, Schlegel et al. 2024) | yes |
| Stimulus / motor neuron IDs | [erojasoficial-byte/fly-brain](https://github.com/erojasoficial-byte/fly-brain) (MIT) | yes |
