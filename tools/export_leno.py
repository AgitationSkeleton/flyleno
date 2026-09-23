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

# ---- lip-sync: a "MouthOpen" shape key (the rig has no jaw bone). The lower face below the lip line
# rotates down around a hinge in front of the ears; weights fade toward the lip line and the cheeks.
# Landmarks measured on a front render (mouth line ~7.7 cm and chin ~15 cm below the head bone).
from mathutils import Matrix, Vector
head_w = (arm.matrix_world @ arm.data.bones["head"].head_local)
MOUTH_Z, CHIN_Z = head_w.z - 0.074, head_w.z - 0.17
HINGE = Vector((0.0, head_w.y + 0.01, head_w.z - 0.06))
OPEN_DEG = 26.0
if not mesh.data.shape_keys:
    mesh.shape_key_add(name="Basis", from_mix=False)
key = mesh.shape_key_add(name="MouthOpen", from_mix=False)
hg = mesh.vertex_groups.get("head")
Mw, Mi = mesh.matrix_world, mesh.matrix_world.inverted()
smooth = lambda a, b, x: 0.0 if x <= a else 1.0 if x >= b else (lambda t: t * t * (3 - 2 * t))((x - a) / (b - a))
moved = 0
for v in mesh.data.vertices:
    p = Mw @ v.co
    w_head = next((g.weight for g in v.groups if hg and g.group == hg.index), 0.0)
    if w_head < 0.3 or p.z > MOUTH_Z + 0.004 or p.z < CHIN_Z or p.y > head_w.y + 0.02:
        continue
    f = (1 - smooth(MOUTH_Z - 0.008, MOUTH_Z + 0.004, p.z))          # fade at the lip line
    f *= 1 - smooth(0.045, 0.095, abs(p.x - head_w.x))               # fade toward the cheeks
    f *= 1 - smooth(head_w.y - 0.03, head_w.y + 0.02, p.y)           # front of the head only
    f *= w_head
    if f <= 0.001:
        continue
    R = Matrix.Rotation(math.radians(OPEN_DEG * f), 4, 'X')
    q = HINGE + (R @ (p - HINGE))
    key.data[v.index].co = Mi @ q
    moved += 1
print(f"MouthOpen shape key: {moved} vertices")
if moved == 0:
    pts = [(Mw @ v.co) for v in mesh.data.vertices]
    print("DEBUG head_w", tuple(head_w), "hg", hg and hg.name, "groups", [g.name for g in mesh.vertex_groups][:12])
    print("DEBUG z-range", min(p.z for p in pts), max(p.z for p in pts), "y-range", min(p.y for p in pts), max(p.y for p in pts))
    print("DEBUG n below mouth & above chin", sum(1 for p in pts if CHIN_Z < p.z < MOUTH_Z))

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

# ---- head-only static mesh for the "Fly-Leno" body (keeps the MouthOpen shape key), origin at the head
# bone, facing +Z in glTF. Written next to the main export as grey_leno_head.glb.
bpy.ops.object.select_all(action="DESELECT")
mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
bpy.ops.object.duplicate()
head_obj = bpy.context.active_object
head_obj.name = "GreyLenoHead"
for m in list(head_obj.modifiers):
    head_obj.modifiers.remove(m)
mw = head_obj.matrix_world.copy()
head_obj.parent = None
head_obj.matrix_world = mw
groups = {g.name: g.index for g in head_obj.vertex_groups}
keep_idx = {groups.get("head"), groups.get("neck_02")}
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="DESELECT")
bpy.ops.object.mode_set(mode="OBJECT")
for v in head_obj.data.vertices:
    w = sum(g.weight for g in v.groups if g.group in keep_idx)
    v.select = w < 0.5
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.delete(type="VERT")
bpy.ops.object.mode_set(mode="OBJECT")
head_obj.vertex_groups.clear()
# origin at the head bone
hw = arm.matrix_world @ arm.data.bones["head"].head_local
head_obj.data.transform(Matrix.Translation(-(head_obj.matrix_world.inverted() @ hw)), shape_keys=True)
head_obj.location = (0, 0, 0)
bpy.ops.object.select_all(action="DESELECT")
head_obj.select_set(True)
head_out = os.path.join(os.path.dirname(out), "grey_leno_head.glb")
bpy.ops.export_scene.gltf(filepath=head_out, export_format="GLB", use_selection=True, export_skins=False,
                          export_animations=False, export_yup=True, export_morph=True, export_image_format="AUTO")
print("wrote", head_out, os.path.getsize(head_out), "verts", len(head_obj.data.vertices))
