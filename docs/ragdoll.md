# Leno active ragdoll

`js/ragdoll.js` turns Grey Leno into a physics "active ragdoll" (Rapier). Every joint DOF is driven by an
antagonistic flexor/extensor muscle pair. The pairs follow the layout in `tools/body_spec.json`: 23 DOFs,
46 muscles, with the same names as `data/neurons.json` → `muscles`. `js/vnc.js` is a small central
pattern generator, a stand-in for the fly's ventral nerve cord. `tools/ragdoll-preview.html` is the test bench.

Rapier: `@dimforge/rapier3d-compat@0.19.3`, loaded from
`https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm` (the WASM is inlined, no extra files).

```js
import { initPhysics, RagdollLeno } from './ragdoll.js';
import { VNC } from './vnc.js';
const { RAPIER, world } = await initPhysics();                    // gravity -9.81, 1/120 s steps
const rag = new RagdollLeno({ RAPIER, world, model /* gltf.scene, scaled by HOST_SCALE, bones at rest */, groundMeshes });
rag.place(stageTop, yaw);
const vnc = new VNC();
// each frame
const act = vnc.update(dt, motorCommand, { yawRate: rag.getState().yawRate });  // or mix with brain muscle pools
rag.setActivations(act); rag.setSupport(1);
rag.step(dt); rag.syncSkin();
```

## Body

There are 14 rigid bodies, sized from the bone positions at bind (× model scale), about 81 kg in total.

| Body | Shape | From | Mass |
|---|---|---|---|
| pelvis | capsule across the hips | thigh_l ↔ thigh_r | 12 kg |
| chest | box | spine_01 → neck_01 | 26 kg |
| head | capsule | neck_01 → top of skull | 5.5 kg |
| upperarm_l/r | capsule | upperarm → lowerarm | 2.3 kg |
| lowerarm_l/r (incl. hand) | capsule | lowerarm → middle_01 | 1.8 kg |
| thigh_l/r | capsule | thigh → calf | 9.5 kg |
| calf_l/r | capsule | calf → foot | 4 kg |
| foot_l/r | box, heel to toe | foot, ball | 1.2 kg |

- At bind, every body keeps the identity orientation of the character frame (+X = Leno's left, +Y = up,
  +Z = forward). Only the colliders are rotated along the bones. Joint frames are therefore the character axes.
- **Collisions:** body parts collide only with the ground. Leno's thick thighs overlap at bind, and
  leg-to-leg contact glued the legs together. Joined pairs also have contacts disabled.
- **Friction:** feet use friction 1.5 with the Max combine rule; other parts use 0.6.
- **Ground:** `groundMeshes` (any meshes or groups) are merged into one fixed trimesh with world
  transforms baked in. It uses `FIX_INTERNAL_EDGES` when possible and falls back to a plain trimesh.
  Call `setGround(meshes)` to rebuild it.
- **Skinning:** `syncSkin()` drives the bones pelvis, spine_01, neck_01, upperarm, lowerarm, thigh, calf
  and foot as *body world × bind offset*, where the offset is captured at construction. All other bones
  keep their rest local transform, so spine_02/03, the clavicles, the hands and the fingers ride along rigidly.

## Joints

All joints are Rapier generic impulse joints: linear axes locked, the listed angular axes free, with
limits from the spec.

| Joint | Parent → child | DOFs (deg), flex = + |
|---|---|---|
| spine | pelvis → chest | pitch −25..40 (bend forward), yaw ±35 (twist left), roll ±25 (lean left) |
| neck | chest → head | pitch −35..45 (nod down), yaw ±70 (look left); roll locked |
| hip | pelvis → thigh | pitch −30..100 (leg forward), roll −15..45 (abduct), yaw ±30 (toe out) |
| knee | thigh → calf | pitch 0..140 (bend), hinge about X |
| ankle | calf → foot | pitch ±40 (toes up), hinge about X |
| shoulder | chest → upperarm | pitch −60..170 (arm forward/up), roll −80..90 (abduct), yaw ±60 (arm forward/inward) |
| elbow | upperarm → lowerarm | pitch 0..145 (bend), hinge perpendicular to the A-pose forearm |

- Angles are relative to the rest pose (A-pose arms, straight legs). `getJointAngles()` returns the
  current angles in the same convention.
- **Rapier gotcha:** a generic joint's frame is built from its axis with `orthonormal_basis()`. For axis
  (1,0,0) the frame is X = world X, Y = world −Z, Z = world +Y. So yaw is `AngZ` and roll is −`AngY`.
  The table `PHYS_AXIS` handles this.
- **Rapier gotcha:** a motor with stiffness = damping = 0 is a *rigid lock*, not "off". Every motor
  therefore keeps a tiny minimum damping (`MIN_DAMP`).

## Muscle model

For each DOF, with activations `a_f` (flex) and `a_e` (ext) in 0..1:

```
d         = a_f - a_e
target    = d >= 0 ? d * max : -d * min            (rest = 0, so d = ±1 reaches the limit)
stiffness = S_joint * scale * (K_BASE + K_GAIN * (a_f + a_e))       co-contraction stiffens
damping   = DAMP_RATIO * sqrt(scale) * stiffness + PASSIVE_DAMP
```

The motors are Rapier force-based position motors, which are implicit and stable at high gains.

- **Joint strengths** are in `MUSCLE_TUNING.strength` (N·m/rad at `a_f + a_e = 1`): hip 3500, knee
  2000, ankle 1200, spine 800, shoulder 90, neck 70, elbow 45. The legs must be stiff enough to track
  a 1.3 Hz gait (a leg's inertia about the hip is about 6 kg·m²). The ankles must be stiffer than m·g·h,
  or a standing body tips over like an inverted pendulum.
- **Silent brain:** with all activations 0, stiffness is `K_BASE` (2 %) and Leno goes limp. At support
  0 he collapses (pelvis about 0.5 m); at support 1 he hangs in the strings.
- **Missing names:** `setActivations` treats missing names, NaN and values outside 0..1 as clamped (missing = 0).

## Support ("puppet strings", `setSupport(0..1)`)

All gains below are multiplied by the support level. The tuning lives in `SUPPORT_TUNING`.

- **Vertical strings** on the top of the chest (88 %) and on the head (12 %). They are explicit
  pull-only spring-dampers toward standing height above the ground under them (found by raycast).
  - They have `slack` (8 cm × scale) before they engage.
  - They carry the full weight at `sagPerWeight` (15 cm × scale) of sag.
- **Horizontal centering** on the chest string toward the point above the feet (`center`). It stands
  for the puppeteer holding the control bar over the puppet. Without it, the vertical strings plus the
  upright torque let the body slide forward off its feet.
- **Pelvis upright torque and yaw damping:** an implicit joint motor to a kinematic anchor that is
  teleported to the pelvis position and heading every substep. It has tilt stiffness and damping plus
  yaw-rate damping (`yawDamp`), but no yaw stiffness, so the heading stays free.
- **Results:**
  - support 1: stands and walks.
  - support 0.5: still walks.
  - support 0: no balance. The open-loop VNC idle topples within a few seconds; there is no balance reflex.

## VNC (`js/vnc.js`)

`update(dt, {forward, backward, turn, startle, groom, feed}, sense?)` computes joint-angle targets in
degrees plus a tone per DOF. It converts them to muscle pairs as
`a_f = tone + max(u, 0)` and `a_e = tone + max(−u, 0)`, where `u = angle / range`. Commands are smoothed
(τ 0.3 s; startle 0.06 s). Tuning is in `VNC_TUNING`.

- **Idle posture tone:** legs 0.35, spine 0.35, neck 0.25, arms 0.12. The arms drop from the A-pose
  (shoulder roll −30°) and the knees are slightly bent.
- **Walk:**
  - One phase oscillator; the legs are in anti-phase.
  - hip = `A·sin(φ + hipLead)` (the thigh leads the knee by 0.5 rad).
  - knee = `kneeSwing·max(0, cos φ)²` in swing.
  - ankle dorsiflexes in swing (toe clearance) and plantarflexes (push-off) in late stance.
  - The arms swing opposite to the legs.
  - Frequency is 0.9 → 1.3 Hz with drive. Stride length scales with drive; foot clearance does not.
- **Backward:** the phase runs in reverse (the hip lead flips) with `backStride` 0.45.
- **Turn** (+ = left) uses two mechanisms:
  - a stance-phase hip-yaw sweep that rotates the pelvis around the planted foot (`turnYaw`);
  - inner/outer stride asymmetry (`turnStride`).
  |turn| alone makes Leno step in place.
- **Yaw feedback** (optional `sense.yawRate`, e.g. `getState().yawRate`): this is like the fly's
  halteres, whose mechanosensory feedback enters the VNC. `turn` sets a desired yaw rate
  (`maxYawRate`) and the stride-averaged error is servoed through the turn mechanisms. Leno's rig is
  asymmetric, so the open-loop gait drifts slowly without it.
- **Groom:** both hands go to the face (shoulder pitch 52°, yaw inward, elbow 135°) and rub in
  anti-phase at 3.2 Hz; the head is bowed.
- **Startle:** legs extend onto tiptoe, arms fly up and out (shoulder roll 88°), head and chest go
  back, and co-contraction is high (tone 0.7).
- **Feed/talk:** lean in (spine 18°), talking nods at about 4–7 Hz, anti-phase hand gestures.

## Measurements

Preview platform, support 1, VNC only, 60 Hz control, simulated synchronously:

| Command | Result |
|---|---|
| idle, 30 s | pelvis 1.33 m (bind 1.37 m), drift 5 cm |
| forward 1 | 8.8 m in 8 s (≈1.1 m/s), heading drift ≤ 6° |
| forward 0.5 | 2.2 m in 8 s |
| backward 1 | ≈ −5 m in 5 s (stage) |
| turn ±1 in place | ≈ ±100–115° in 8 s |
| forward 1 + turn ±1 | 3.5–4.4 m and ±75–110° in 8 s |
| limp (no activation), support 0 | collapses, `fallen` = true |
| random "brain" noise on all 46 muscles, 30 s | no NaN or explosion |

- On the real TUURD stage meshes: forward 4.2 m and backward −5.2 m in 5 s, turn 66° in 5 s; the
  trimesh builds in 1.5 ms.
- **Cost** (Brave, Windows 10): `step(1/60)` (two 120 Hz substeps) averages 0.19 ms (p99 0.4 ms);
  `syncSkin` 0.06 ms; `getState` 0.01 ms.

## Tuning tips

- **Not stepping forward** (feet stay behind, "hamstring curls"): raise `hipLead`, `ankleSwing` or
  hip/knee strength. The swing foot must clear the ground, because a dragging toe at friction 1.5
  pushes Leno backward.
- **Wobbly heading:** raise `SUPPORT_TUNING.yawDamp`, or pass `sense` to the VNC.
- **Turning too slow:** raise `turnYaw` or `turnStride` (and `maxYawRate` when using feedback).
- **Brain-driven chaos:** mix brain pools with the VNC as `clamp(w_vnc·vnc + w_brain·brain)`. Raise
  support if Leno keeps falling; that is the puppet-game answer.
- **Live tuning:** all tuning objects (`MUSCLE_TUNING`, `SUPPORT_TUNING`, `VNC_TUNING`) are exported
  and read at run time. The exceptions are foot friction (read at construction) and the VNC tuning,
  which is copied at construction (`vnc.T`).
