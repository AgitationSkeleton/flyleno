"""
Convert the Grey Leno Blender project (DAD_Leno.blend, Unreal-style 104-bone rig, centimetre
units) into a web-ready skinned glTF (assets/grey_leno.glb) in metres, Y-up, facing +Z.

Run with Blender 4.2+ (tested 5.2.2):
    blender -b assets/_src/leno/DAD_Leno.blend --python tools/export_leno.py -- assets/grey_leno.glb
"""
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
blend_dir = os.path.dirname(bpy.data.filepath)
out = os.path.abspath(argv[0]) if argv else os.path.join(blend_dir, "..", "..", "grey_leno.glb")

# Re-link the texture (the .blend points at the author's local THPS folder) and pack it
img = bpy.data.images.get("T_Leno.PNG")
img.filepath = os.path.join(blend_dir, "T_Leno.PNG")
img.reload()
img.pack()

arm = bpy.data.objects["Armature"]
mesh = bpy.data.objects["SK_Charlie"]
mesh.name = "GreyLeno"
arm.name = "GreyLenoRig"

# The rig is authored in centimetres (UE). Scale the armature to metres and apply scale on
# armature + mesh so bones and skin share unit scale in the export.
bpy.ops.object.select_all(action="DESELECT")
arm.scale = (0.01, 0.01, 0.01)
# Rotate so the character faces -Y in Blender, which the glTF exporter's Z-up -> Y-up conversion
# maps to +Z (three.js "towards the camera"). Facing is measured from the foot -> toe bones.
bpy.context.view_layer.update()
foot = arm.matrix_world @ arm.data.bones["foot_l"].head_local
toe = arm.matrix_world @ arm.data.bones["ball_l"].head_local
fwd = toe - foot
yaw = math.atan2(fwd.y, fwd.x)
arm.rotation_euler = (0, 0, math.radians(-90) - yaw)
for o in (arm, mesh):
    o.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
bpy.context.view_layer.update()

# Report size for sanity
zs = [(mesh.matrix_world @ v.co).z for v in mesh.data.vertices]
foot = arm.matrix_world @ arm.data.bones["foot_l"].head_local
toe = arm.matrix_world @ arm.data.bones["ball_l"].head_local
print(f"Leno height: {max(zs) - min(zs):.3f} m, feet min z {min(zs):.3f}, facing {tuple(round(v, 2) for v in (toe - foot).normalized())}")

bpy.ops.export_scene.gltf(
    filepath=out,
    export_format="GLB",
    use_selection=True,
    export_skins=True,
    export_animations=False,
    export_yup=True,
    export_apply=False,
    export_image_format="AUTO",
)
print("wrote", out, os.path.getsize(out))
