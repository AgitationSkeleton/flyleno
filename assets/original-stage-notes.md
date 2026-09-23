# Original talk-show stage (`js/stage-original.js`)

`loadOriginalStage(scene, { lite })` builds a stage **from code alone**, in the spirit of the TUURD Talk set.
It returns the same `{ root, markers, ground, markerGroup, screens }` shape as `loadStage` in `js/stage.js`.
It loads no GLB, no images and no marker JSON. Preview it with `tools/stage-preview.html`.

## What is modelled

| Element | How |
|---|---|
| Speaking platform | 4 stacked carpeted drums (Cylinder + Ring/Circle): radii 8.84 / 8.34 / 7.84 / 7.34 m, top at y = 1.167 |
| TUURD letters | `TextGeometry` (Droid Sans Bold), 3.28 m tall × 13.2 m wide, one beside the platform and one on the back tier |
| Backdrop screen | 43.4 × 18.2 m plane with an animated canvas: gradient, rays, ribbons, sparkles, "TUURD Talk" logo, LIVE badge and ticker |
| Side walls | 2 stacked 15.9 × 8.2 m screens per side (logo/APPLAUSE and equaliser canvases), red frames and pillars |
| Curtains | red velvet panels whose folds are displaced in the geometry, plus a matching procedural fold texture; swagged valance and pelmet |
| Truss rig | corner towers, perimeter grid, one cross truss and 4 lamp towers, all instances of one procedural truss bay |
| Lights (props) | 16 hanging cans with glowing lenses (instanced), footlights along the screen base |
| Seating | 360 blue cinema seats (rounded boxes, instanced), 3 raised two-step tiers with blue LED nosing |
| Props | stylised toilets (lathe), a giant vintage microphone, gift boxes and a studio TV camera, all original and simple |
| Textures | all drawn on canvases at runtime: carpet noise, velvet folds, charcoal floor, navy riser carpet |

The props in the game (giraffe, elephant, teddy, doll, pentagrams, money, bar, beds, cloaked figures) are left out.
Performance: **22 draw calls** and about 288k triangles with Leno in the preview. The static geometry is merged per
material with `mergeGeometries`, and the seats, truss, cans and toilets are `InstancedMesh`es. The rig has 4 spotlights,
plus 5 point lights when `lite` is off.

## Layout facts measured from the reference

These values came from node transforms, bounding boxes and marker coordinates in the reference scene. They are
hard-coded in the module as plain numbers.
- Platform: centre (0, −7.19), outer radius 8.84 m, top y 1.167. Host spot (0.15, 1.167, −4.94); guest spot (2.43, −7.78).
- Seats: the origin and yaw of each of the 18 rows, and the 20 seat offsets along a row (≈0.79 m pitch). Seat rows are at
  y 0.2, 2.2 and 4.12. The raised sections are ≈22.9 × 11 m, with the top at y 5.97.
- Screen: centre (−0.68, 10.59, −21.85), 43.4 × 18.2 m. Side screens at x ≈ 22.5 / −23.7, with z from −20.4 to −4.5.
- TUURD letters: centre (−7.31, −15.99), yaw 19.7°, 3.28 m tall; second copy at (0.23, 5.9, 34.1), facing the stage.
- Curtain, corner-tower, upper-girder (y 15.35–17.5) and spotlight-can positions; toilet seat points; default camera pose.

The platform tier count and step widths were estimated from screenshots, not measured.
The generated markers match the reference markers within 1 mm (seats and toilets) and use the same JSON shape
(`host`, `guest`, `camera`, `stageCenter`, `audience[]`, `toiletSeats[]`, `randomSpawns[]`, `lights[]`).
`randomSpawns` are new aisle points. `lights[]` lists this rig's lights, not the game's.

## No game content

**No game geometry, vertex data, triangles, UVs, textures or images are used, copied or transformed**, and the game
files are not loaded at runtime. Every mesh is built from three.js primitives by this module, and every texture is
drawn procedurally on a canvas. The screen graphics are original and do not use the game's show images.

## Third-party pieces

- three.js 0.170 (MIT), including the addons `BufferGeometryUtils`, `RoundedBoxGeometry`, `FontLoader` and `TextGeometry`.
- Font: **Droid Sans Bold**, © 2008 The Android Open Source Project, **Apache License 2.0**. See
  `three/examples/fonts/droid/NOTICE` and `README.txt`. It is fetched from jsdelivr at runtime and is not stored in this repo.
  If the fetch fails, the module falls back to box-built letters.
- Canvas text on the screens uses the viewer's system fonts (Arial Black / Arial / sans-serif), which are rendered at
  runtime and not distributed.
