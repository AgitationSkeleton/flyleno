# FlyLeno: TUURD Talk, hosted by a fruit fly

A browser simulation in which a **whole-brain spiking model of the adult fruit fly** (*Drosophila
melanogaster*, FlyWire v783) puppeteers **Grey Leno** on the **TUURD Talk** stage from
*Nightmare Puppeteer*. Talk-show events such as applause, snacks, hecklers and rotten tomatoes
stimulate the fly's sensory neurons. The fly's descending neurons drive Leno's walking, turning,
startle, grooming and "talking". A sidebar shows the brain's activity live.

It is a static site with no build step. three.js loads from a CDN, and the brain runs in a Web Worker.

## Running locally

```bash
# 1. regenerate the third-party 3D assets (not in git, see "Asset licensing")
python tools/export_tuurd_stage.py                    # -> assets/tuurd_talk_stage.glb, markers, show_bg/
blender -b assets/_src/leno/DAD_Leno.blend --python tools/export_leno.py -- assets/grey_leno.glb

# 2. serve the folder (module workers need http://, not file://)
python -m http.server 8123
# open http://127.0.0.1:8123/        (?lite = no stage point lights, for slow GPUs)
```

`assets/_src/leno/` is the unzipped `Blender Project Files-917-0-1-*.zip` (DAD_Leno.blend + T_Leno.PNG).
The Leno export needs Blender 4.2 or newer; it was tested with 5.2.2 in `D:\Claude_FruitFly\tools\`. The
Steam copy is 2.79 and cannot open the file.

The brain data in `data/` is committed. To rebuild it, run `python tools/build_connectome.py`,
which needs `pandas` and `pyarrow` and reads the clones in `D:\Claude_FruitFly\sources`.

## Layout

| Path | What |
|---|---|
| `index.html`, `css/`, `js/` | the app |
| `js/brain-worker.js` | LIF engine (Web Worker) |
| `js/motor.js` | descending-neuron rates → Leno motor command (gains) |
| `js/leno.js` | Leno loader, procedural rig, locomotion on the stage |
| `js/stage.js` | stage loader, lights, backdrop screens, marker helpers |
| `js/director.js` | autopilot "show director" (random show events) |
| `js/ui.js` | sidebar: stats, motor meters, raster, rates, super-classes |
| `data/connectome.bin.gz` | full FlyWire v783 connectivity, 15,091,983 connections (31 MB) |
| `data/neurons.json` | super-class per neuron, stimulus/motor groups, model parameters |
| `assets/tuurd_talk_markers.json` | stage markers (committed; plain coordinates) |
| `tools/export_tuurd_stage.py` | Unity scene → GLB + markers (UnityPy) |
| `tools/export_leno.py` | Blender: .blend → skinned GLB in metres |
| `tools/build_connectome.py` | Shiu parquet + FlyWire annotations → `data/` |
| `tools/neuron_groups.json` | FlyWire root IDs of stimulus and motor groups |
| `tools/reference_sim.py` | brute-force NumPy reference used to validate the JS engine |

## The stage asset (`assets/tuurd_talk_stage.glb`)

This is the Unity scene `TuubeTerk.unity`, which is `level43` in the build (show name "Tuurd Talk"),
exported with UnityPy.
- **Contents:** 68 meshes, 48 materials, 31 textures and the scene's 19 lights (`KHR_lights_punctual`).
- **Coordinates:** converted to glTF, right-handed with +Y up. The stage faces **+Z** toward the audience.
- **Scale:** the set is built at about 1.4× human scale (seats are 0.77 m apart), so Leno is scaled 1.35×.

Markers are empty nodes under the `Markers` node and are duplicated in `assets/tuurd_talk_markers.json`:

| Marker | Count | Source |
|---|---|---|
| `HOST_CenterStage` | 1 | game's `Actor1SpawnPosition`, on the speaking platform |
| `STAGE_Center` | 1 | top-centre of the `SpeakingPlatform` bounds (walk-area centre) |
| `GUEST_Spot` | 1 | `Actor2SpawnPosition` |
| `CAMERA_Default` | 1 | the game's `GodsCamera` |
| `AUDIENCE_rRR_sSS` | 360 | 18 rows × 20 `Seat` transforms of `SittingCrowdInCinemaSeats`, where the game spawns the crowd; each has `toHost` (facing vector) |
| `TOILETSEAT_NN` | 11 | sittable toilets (one is on stage) |
| `SPAWN_Random_NN` | 10 | `RandoSpawnPositions` |
| `LIGHT_*` | 19 | scene lights |

Turn on **markers** in the viewport to see the seat markers.

## The brain

The engine is a leaky integrate-and-fire network after **Shiu et al. 2024**
([philshiu/Drosophila_brain_model](https://github.com/philshiu/Drosophila_brain_model)). It uses
the same parameters as that model:

- v₀ = v_reset = −52 mV, v_th = −45 mV
- τ_m = 20 ms, τ_syn = 5 ms
- refractory period 2.2 ms, synaptic delay 1.8 ms
- 0.275 mV per synapse
- dt = 0.1 ms, with Poisson drive for stimulated neurons

Integration is exact, and the engine is **lazy**. A neuron is only stepped while an upper bound
on its future voltage peak can still reach threshold; otherwise it is advanced in closed form
when its next input arrives. This keeps the full 138,639-neuron network at about real time in
plain JavaScript.

`tools/reference_sim.py` steps every neuron (brute force) and reproduces the engine's results.

Responses of the engine with a brain reset between stimuli, 3 s each:

| Show event | Neurons stimulated | Response |
|---|---|---|
| Applause | JO, 209 neurons | aDN1 grooming 35 Hz → Leno rubs his face |
| Snack break | sugar GRNs, 21 | MN9 ~100 Hz → Leno leans in and "talks" |
| Heckler looms | LC4, 104 | giant fiber ~140 Hz → startle jump |
| Rotten tomato | bitter GRNs, 42 | no motor output (bitter suppresses feeding) |
| Walk / turn / back-up drives | "fictive": P9, DNa01+02 per side, MDN | walk, turn, walk backward |
| Smells bad ⚠ | Or56a, 39 | runaway self-sustained activity (see below) |

**Runaway activity:** in this model, Or56a stimulation ignites self-sustaining activity of about
900k spikes/s that outlives the stimulus. The NumPy reference confirms that this is a property of
the model, not an engine bug. Autopilot never fires it. If it happens anyway, autopilot calls a
"commercial break" that resets the brain, or you can press **Reset**.

**Motor decoding** is in `js/motor.js`. Rates are smoothed with a 250 ms EMA and divided by a
saturation rate (default 40 Hz, and 15 Hz for the giant fiber):
- forward = P9 + P9-oDN1
- turn = (DNa01+DNa02 left − right)
- backward = MDN
- startle = giant fiber
- groom = aDN1
- feed/talk = MN9

The gains can be tuned live with `flyleno.motorGains`. Walking off the platform is blocked; at
the edge a body reflex turns Leno back toward the stage centre. That reflex is not neural.

## Deploying (GitHub Pages)

The page is static, so Pages can serve the repo root directly. Before enabling Pages, note two things:

- **GitHub Pages sites are public**, even when the repository is private, unless the account is on
  GitHub Enterprise Cloud with private Pages.
- **The 3D assets are not in the repository** (see below), so a deployed site would show the
  "could not load the 3D assets" message until they are hosted somewhere that is allowed.

## Asset licensing

| Asset | Owner / terms | In git? |
|---|---|---|
| TUURD Talk stage, backdrop images | *Nightmare Puppeteer*, © its developer | **no** (`.gitignore`) |
| Grey Leno model | original by Vinesauce; Dead as Disco port by huckleberrypie ([Nexus mod 917](https://www.nexusmods.com/deadasdisco/mods/917)). The mod page says: no uploading to other sites, no conversion to other games, and asset use only with permission. | **no** (`.gitignore`) |
| Connectome + LIF model | Shiu et al. 2024 (MIT); FlyWire v783 (Dorkenwald et al. 2024, Schlegel et al. 2024) | yes (`data/`) |
| Stimulus / motor neuron IDs | [erojasoficial-byte/fly-brain](https://github.com/erojasoficial-byte/fly-brain) (MIT) | yes |

Get permission from these rights holders before publishing a build that includes the stage or Leno.

## Roadmap

- Modelled audience members on the `AUDIENCE_*` markers (react to applause and heckler events)
- Close the loop with real senses, e.g. crowd noise → JO, Leno's view → visual neurons
- Guest on the `GUEST_Spot`
