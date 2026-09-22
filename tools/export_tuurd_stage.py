"""
Export the "Tuurd Talk" stage (Unity scene TuubeTerk.unity == level43) from
Nightmare Puppeteer to a portable glTF binary (.glb) plus a markers JSON.

Requires: Python 3.10+, UnityPy, numpy, Pillow
    python tools/export_tuurd_stage.py [--game "D:/SteamLibrary/steamapps/common/Nightmare Puppeteer"]

Output (assets/):
    tuurd_talk_stage.glb      geometry, materials, textures, lights, marker empties
    tuurd_talk_markers.json   the same markers as plain data (glTF / three.js coordinates)

Coordinate conversion: Unity is left-handed Y-up (+Z forward). glTF is right-handed
Y-up. We mirror X: p' = (-x, y, z), q' = (x, -y, -z, w), and flip triangle winding.
UV v is flipped (v' = 1 - v) because Unity textures are bottom-up.
"""
import argparse
import io
import json
import math
import os
import re
import struct
import sys
from collections import OrderedDict

import numpy as np
import UnityPy
from PIL import Image
from UnityPy.helpers.MeshHelper import MeshHandler

SCENE_FILE = "level43"  # BuildSettings index 43 = Assets/Scenes/NightmareScenes/TuubeTerk.unity
MAX_TEX = 1024
# Saved inactive in the scene but switched on by the game at runtime
RUNTIME_ENABLED = {"ToEnable"}

ap = argparse.ArgumentParser()
ap.add_argument("--game", default=r"D:\SteamLibrary\steamapps\common\Nightmare Puppeteer")
ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "assets"))
args = ap.parse_args()

data_dir = os.path.join(args.game, "NightmarePuppeteer_Data")
os.makedirs(args.out, exist_ok=True)
env = UnityPy.load(os.path.join(data_dir, SCENE_FILE))

# ---------------------------------------------------------------- scene graph
transforms = {}   # path_id -> Transform
go_of = {}        # transform path_id -> GameObject
for obj in env.objects:
    if obj.type.name in ("Transform", "RectTransform"):
        t = obj.read()
        transforms[obj.path_id] = t
        go_of[obj.path_id] = t.m_GameObject.read()


def components(go):
    out = {}
    for c in go.m_Component:
        ptr = getattr(c, "component", c)
        try:
            o = ptr.deref()
            out.setdefault(o.type.name, []).append(o)
        except Exception:
            pass
    return out


def is_active(go):
    return go.m_IsActive or go.m_Name in RUNTIME_ENABLED


def active_in_hierarchy(tid):
    while tid:
        if not is_active(go_of[tid]):
            return False
        f = transforms[tid].m_Father
        tid = f.path_id if f else 0
    return True


def quat_to_mat(x, y, z, w):
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def local_matrix(t):
    p, r, s = t.m_LocalPosition, t.m_LocalRotation, t.m_LocalScale
    m = np.eye(4)
    m[:3, :3] = quat_to_mat(r.x, r.y, r.z, r.w) @ np.diag([s.x, s.y, s.z])
    m[:3, 3] = [p.x, p.y, p.z]
    return m


world_cache = {}


def world_matrix(tid):
    if tid in world_cache:
        return world_cache[tid]
    t = transforms[tid]
    f = t.m_Father.path_id if t.m_Father else 0
    m = local_matrix(t) if not f or f not in transforms else world_matrix(f) @ local_matrix(t)
    world_cache[tid] = m
    return m


MIRROR = np.diag([-1.0, 1.0, 1.0, 1.0])


def to_gltf_matrix(m_unity):
    return MIRROR @ m_unity @ MIRROR


def mat_to_trs(m):
    t = m[:3, 3].copy()
    sx, sy, sz = (np.linalg.norm(m[:3, i]) for i in range(3))
    if np.linalg.det(m[:3, :3]) < 0:
        sx = -sx
    r = m[:3, :3] / np.array([sx, sy, sz])
    # rotation matrix -> quaternion
    tr = np.trace(r)
    if tr > 0:
        s = math.sqrt(tr + 1.0) * 2
        q = [(r[2, 1] - r[1, 2]) / s, (r[0, 2] - r[2, 0]) / s, (r[1, 0] - r[0, 1]) / s, 0.25 * s]
    elif r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
        s = math.sqrt(1.0 + r[0, 0] - r[1, 1] - r[2, 2]) * 2
        q = [0.25 * s, (r[0, 1] + r[1, 0]) / s, (r[0, 2] + r[2, 0]) / s, (r[2, 1] - r[1, 2]) / s]
    elif r[1, 1] > r[2, 2]:
        s = math.sqrt(1.0 + r[1, 1] - r[0, 0] - r[2, 2]) * 2
        q = [(r[0, 1] + r[1, 0]) / s, 0.25 * s, (r[1, 2] + r[2, 1]) / s, (r[0, 2] - r[2, 0]) / s]
    else:
        s = math.sqrt(1.0 + r[2, 2] - r[0, 0] - r[1, 1]) * 2
        q = [(r[0, 2] + r[2, 0]) / s, (r[1, 2] + r[2, 1]) / s, 0.25 * s, (r[1, 0] - r[0, 1]) / s]
    q = np.array(q) / np.linalg.norm(q)
    return t.tolist(), q.tolist(), [sx, sy, sz]


# ------------------------------------------------------------------ glb writer
class GLB:
    def __init__(self):
        self.bin = bytearray()
        self.g = OrderedDict(
            asset={"version": "2.0", "generator": "flyleno export_tuurd_stage.py"},
            scene=0, scenes=[{"name": "TuurdTalk", "nodes": []}], nodes=[], meshes=[],
            materials=[], textures=[], images=[], samplers=[{"magFilter": 9729, "minFilter": 9987, "wrapS": 10497, "wrapT": 10497}],
            accessors=[], bufferViews=[], buffers=[],
        )

    def view(self, data: bytes, target=None):
        while len(self.bin) % 4:
            self.bin += b"\0"
        v = {"buffer": 0, "byteOffset": len(self.bin), "byteLength": len(data)}
        if target:
            v["target"] = target
        self.bin += data
        self.g["bufferViews"].append(v)
        return len(self.g["bufferViews"]) - 1

    def accessor(self, arr, ctype, typ, target, minmax=False):
        arr = np.ascontiguousarray(arr)
        a = {"bufferView": self.view(arr.tobytes(), target), "componentType": ctype,
             "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(axis=0).tolist()
            a["max"] = arr.max(axis=0).tolist()
        self.g["accessors"].append(a)
        return len(self.g["accessors"]) - 1

    def add_node(self, node):
        self.g["nodes"].append(node)
        return len(self.g["nodes"]) - 1

    def write(self, path):
        g = {k: v for k, v in self.g.items() if v != []}
        g["buffers"] = [{"byteLength": len(self.bin)}]
        js = json.dumps(g, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        while len(self.bin) % 4:
            self.bin += b"\0"
        total = 12 + 8 + len(js) + 8 + len(self.bin)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(self.bin), 0x004E4942)); f.write(self.bin)


glb = GLB()

# ------------------------------------------------------------------ textures
tex_cache = {}


def export_texture(ptr):
    if not ptr or ptr.path_id == 0:
        return None
    key = (ptr.file_id, ptr.path_id)
    if key in tex_cache:
        return tex_cache[key]
    try:
        tex = ptr.read()
        img = tex.image
    except Exception as e:
        print("  ! texture failed:", e)
        tex_cache[key] = None
        return None
    if max(img.size) > MAX_TEX:
        img.thumbnail((MAX_TEX, MAX_TEX), Image.LANCZOS)
    has_alpha = img.mode in ("RGBA", "LA") and img.getchannel("A").getextrema()[0] < 250
    buf = io.BytesIO()
    if has_alpha:
        img.convert("RGBA").save(buf, "PNG", optimize=True); mime = "image/png"
    else:
        img.convert("RGB").save(buf, "JPEG", quality=88); mime = "image/jpeg"
    glb.g["images"].append({"name": tex.m_Name, "mimeType": mime, "bufferView": glb.view(buf.getvalue())})
    glb.g["textures"].append({"source": len(glb.g["images"]) - 1, "sampler": 0})
    tex_cache[key] = (len(glb.g["textures"]) - 1, has_alpha)
    return tex_cache[key]


# ------------------------------------------------------------------ materials
mat_cache = {}


def export_material(ptr):
    key = (ptr.file_id, ptr.path_id) if ptr else None
    if key in mat_cache:
        return mat_cache[key]
    m = {"name": "default", "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.8, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}
    try:
        mat = ptr.read()
        props = mat.m_SavedProperties
        texenvs = dict(props.m_TexEnvs)
        colors = dict(props.m_Colors)
        floats = dict(props.m_Floats)
        try:
            shader = mat.m_Shader.read().m_ParsedForm.m_Name
        except Exception:
            shader = ""
        m["name"] = mat.m_Name
        m["extras"] = {"unityShader": shader}
        pbr = m["pbrMetallicRoughness"]
        c = colors.get("_Color") or colors.get("_BaseColor")
        if c is not None:
            pbr["baseColorFactor"] = [c.r, c.g, c.b, c.a]
        pbr["metallicFactor"] = float(floats.get("_Metallic", 0.0))
        pbr["roughnessFactor"] = 1.0 - float(floats.get("_Glossiness", floats.get("_Smoothness", 0.2)))
        te = texenvs.get("_MainTex") or texenvs.get("_BaseMap")
        tex_alpha = False
        if te is not None:
            t = export_texture(te.m_Texture)
            if t:
                info = {"index": t[0]}
                sc, of = te.m_Scale, te.m_Offset
                if (sc.x, sc.y, of.x, of.y) != (1, 1, 0, 0):
                    info["extensions"] = {"KHR_texture_transform": {"scale": [sc.x, sc.y], "offset": [of.x, 1 - of.y - sc.y]}}
                pbr["baseColorTexture"] = info
                tex_alpha = t[1]
        mode = floats.get("_Mode", 0)
        if mode == 1 or "Cutout" in shader:
            m["alphaMode"] = "MASK"; m["alphaCutoff"] = float(floats.get("_Cutoff", 0.5))
        elif mode >= 2 or "Transparent" in shader or "Fade" in shader or (pbr["baseColorFactor"][3] < 0.99):
            m["alphaMode"] = "BLEND"
        elif tex_alpha and ("Unlit" in shader or "Sprite" in shader):
            m["alphaMode"] = "BLEND"
        e = colors.get("_EmissionColor")
        kw = " ".join([str(getattr(mat, "m_ShaderKeywords", "") or "")] + [str(k) for k in (getattr(mat, "m_ValidKeywords", None) or [])])
        if e is not None and "_EMISSION" in kw and (e.r + e.g + e.b) > 0.01:
            mx = max(e.r, e.g, e.b, 1.0)
            m["emissiveFactor"] = [e.r / mx, e.g / mx, e.b / mx]
            et = texenvs.get("_EmissionMap")
            if et is not None:
                t = export_texture(et.m_Texture)
                if t:
                    m["emissiveTexture"] = {"index": t[0]}
        if "Unlit" in shader:
            m.setdefault("extensions", {})["KHR_materials_unlit"] = {}
    except Exception as ex:
        print("  ! material failed:", ex)
    glb.g["materials"].append(m)
    mat_cache[key] = len(glb.g["materials"]) - 1
    return mat_cache[key]


# ------------------------------------------------------------------ meshes
mesh_cache = {}


def export_mesh(mesh_ptr, mat_ptrs):
    key = ((mesh_ptr.file_id, mesh_ptr.path_id), tuple((p.file_id, p.path_id) for p in mat_ptrs))
    if key in mesh_cache:
        return mesh_cache[key]
    mesh = mesh_ptr.read()
    h = MeshHandler(mesh)
    h.process()
    V = np.array(h.m_Vertices, dtype=np.float32).reshape(-1, 3)
    if len(V) == 0:
        mesh_cache[key] = None
        return None
    V[:, 0] *= -1
    attrs = {"POSITION": glb.accessor(V, 5126, "VEC3", 34962, minmax=True)}
    if h.m_Normals and len(h.m_Normals):
        N = np.array(h.m_Normals, dtype=np.float32).reshape(-1, 3)[:, :3]
        if len(N) == len(V):
            N[:, 0] *= -1
            n = np.linalg.norm(N, axis=1, keepdims=True); n[n == 0] = 1
            attrs["NORMAL"] = glb.accessor(N / n, 5126, "VEC3", 34962)
    if h.m_UV0 and len(h.m_UV0):
        UV = np.array(h.m_UV0, dtype=np.float32)
        UV = UV.reshape(len(V), -1)[:, :2].copy()
        UV[:, 1] = 1 - UV[:, 1]
        attrs["TEXCOORD_0"] = glb.accessor(UV, 5126, "VEC2", 34962)
    prims = []
    for si, (tris, sm) in enumerate(zip(h.get_triangles(), mesh.m_SubMeshes)):
        if not tris:
            continue
        idx = np.array(tris, dtype=np.uint32).reshape(-1, 3) + int(getattr(sm, "baseVertex", 0) or 0)
        idx = idx[:, [0, 2, 1]]  # winding flip for the X mirror
        ctype = 5125
        if idx.max() < 65535:
            idx = idx.astype(np.uint16); ctype = 5123
        mp = mat_ptrs[min(si, len(mat_ptrs) - 1)] if mat_ptrs else None
        prims.append({"attributes": attrs, "indices": glb.accessor(idx.reshape(-1), ctype, "SCALAR", 34963),
                      "material": export_material(mp)})
    glb.g["meshes"].append({"name": mesh.m_Name, "primitives": prims})
    mesh_cache[key] = len(glb.g["meshes"]) - 1
    return mesh_cache[key]


# ------------------------------------------------------------------ walk
def has_renderable(tid):
    comps = components(go_of[tid])
    if "MeshFilter" in comps and "MeshRenderer" in comps:
        return True
    return any(has_renderable(c.path_id) for c in transforms[tid].m_Children if c.path_id in transforms)


def build_node(tid):
    t = transforms[tid]
    go = go_of[tid]
    if not is_active(go) or t.object_reader.type.name == "RectTransform" or not has_renderable(tid):
        return None
    ml = to_gltf_matrix(local_matrix(t))
    tr, q, s = mat_to_trs(ml)
    node = {"name": go.m_Name}
    if any(abs(v) > 1e-6 for v in tr): node["translation"] = tr
    if abs(q[3] - 1) > 1e-7: node["rotation"] = q
    if any(abs(v - 1) > 1e-6 for v in s): node["scale"] = s
    comps = components(go)
    if "MeshFilter" in comps and "MeshRenderer" in comps:
        mr = comps["MeshRenderer"][0].read()
        mf = comps["MeshFilter"][0].read()
        if mr.m_Enabled and mf.m_Mesh and mf.m_Mesh.path_id:
            mi = export_mesh(mf.m_Mesh, list(mr.m_Materials))
            if mi is not None:
                node["mesh"] = mi
    kids = [k for k in (build_node(c.path_id) for c in t.m_Children if c.path_id in transforms) if k is not None]
    if kids: node["children"] = kids
    if "mesh" not in node and "children" not in node:
        return None
    return glb.add_node(node)


roots = [tid for tid, t in transforms.items() if not t.m_Father or t.m_Father.path_id == 0]
print(f"{len(transforms)} transforms, {len(roots)} roots")
geo_children = [n for n in (build_node(r) for r in roots) if n is not None]
geo_root = glb.add_node({"name": "Geometry", "children": geo_children})

# ------------------------------------------------------------------ markers
markers = {"coordinateSystem": "glTF / three.js: right-handed, +Y up, metres; stage faces +Z toward the audience",
           "source": "Nightmare Puppeteer / TuubeTerk.unity (level43)", "host": None, "guest": None,
           "camera": None, "audience": [], "toiletSeats": [], "randomSpawns": [], "lights": []}


def marker_from_tid(tid):
    m = to_gltf_matrix(world_matrix(tid))
    tr, q, _ = mat_to_trs(m)
    fwd = (m[:3, :3] @ np.array([0, 0, 1.0]))
    fwd = (fwd / (np.linalg.norm(fwd) or 1)).tolist()
    return {"position": [round(v, 4) for v in tr], "quaternion": [round(v, 6) for v in q],
            "forward": [round(v, 4) for v in fwd]}


def path_of(tid):
    parts = []
    while tid:
        parts.append(go_of[tid].m_Name)
        f = transforms[tid].m_Father
        tid = f.path_id if f else 0
    return "/".join(reversed(parts))


marker_nodes = []
for tid, go in go_of.items():
    name, p = go.m_Name, path_of(tid)
    if not active_in_hierarchy(tid):
        continue
    if name == "Actor1SpawnPosition":
        markers["host"] = {"name": "HOST_CenterStage", **marker_from_tid(tid), "unityPath": p}
    elif name == "Actor2SpawnPosition":
        markers["guest"] = {"name": "GUEST_Spot", **marker_from_tid(tid), "unityPath": p}
    elif name == "GodsCamera":
        markers["camera"] = {"name": "CAMERA_Default", **marker_from_tid(tid), "unityPath": p}
    elif name.startswith("Seat") and "/__SEATS/" in p:
        row = re.search(r"SittingCrowdInCinemaSeats(?: \((\d+)\))?/", p)
        r = int(row.group(1) or 0) if row else -1
        s = int((re.search(r"\((\d+)\)", name) or [0, 0])[1])
        markers["audience"].append({"name": f"AUDIENCE_r{r:02d}_s{s:02d}", "row": r, "seat": s, **marker_from_tid(tid), "unityPath": p})
    elif name == "Seat" and "/Toilet" in p:
        markers["toiletSeats"].append({"name": f"TOILETSEAT_{len(markers['toiletSeats']):02d}", **marker_from_tid(tid), "unityPath": p})
    elif "RandoSpawnPositions/" in p and transforms[tid].m_Father.path_id and go_of[transforms[tid].m_Father.path_id].m_Name == "RandoSpawnPositions":
        markers["randomSpawns"].append({"name": f"SPAWN_Random_{len(markers['randomSpawns']):02d}", **marker_from_tid(tid), "unityPath": p})

markers["audience"].sort(key=lambda a: (a["row"], a["seat"]))

# The audience seats' "Seat" transform sits at the chair; face the host by default (seat rows are not
# individually rotated toward the stage in all cases), so store a facing vector toward the host too.
if markers["host"]:
    hp = np.array(markers["host"]["position"])
    for a in markers["audience"] + markers["toiletSeats"]:
        d = hp - np.array(a["position"]); d[1] = 0
        a["toHost"] = [round(v, 4) for v in (d / (np.linalg.norm(d) or 1)).tolist()]

# Stage centre: centre of the SpeakingPlatform mesh bounds (top surface)
for tid, go in go_of.items():
    if go.m_Name == "SpeakingPlatform":
        comps = components(go)
        mesh = comps["MeshFilter"][0].read().m_Mesh.read()
        b = mesh.m_LocalAABB
        c, e = np.array([b.m_Center.x, b.m_Center.y, b.m_Center.z]), np.array([b.m_Extent.x, b.m_Extent.y, b.m_Extent.z])
        corners = np.array([[*(c + e * np.array([sx, sy, sz])), 1] for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)])
        w = (MIRROR @ world_matrix(tid) @ corners.T).T[:, :3]
        lo, hi = w.min(axis=0), w.max(axis=0)
        markers["stageCenter"] = {"name": "STAGE_Center",
                                  "position": [round(float((lo[0] + hi[0]) / 2), 4), round(float(hi[1]), 4), round(float((lo[2] + hi[2]) / 2), 4)],
                                  "boundsMin": [round(float(v), 4) for v in lo], "boundsMax": [round(float(v), 4) for v in hi],
                                  "note": "top-centre of SpeakingPlatform bounds"}

# lights -> KHR_lights_punctual
lights_ext = []
for obj in env.objects:
    if obj.type.name != "Light":
        continue
    L = obj.read()
    go = L.m_GameObject.read()
    tid = go.m_Component[0].component.path_id if hasattr(go.m_Component[0], "component") else go.m_Component[0].path_id
    if tid not in transforms or not active_in_hierarchy(tid) or not L.m_Enabled:
        continue
    typ = {0: "spot", 1: "directional", 2: "point"}.get(L.m_Type)
    if not typ:
        continue
    c = L.m_Color
    entry = {"name": go.m_Name, "type": typ, "color": [c.r, c.g, c.b], "intensity": float(L.m_Intensity),
             "extras": {"unityRange": float(L.m_Range), "unityIntensity": float(L.m_Intensity)}}
    if typ != "directional":
        entry["range"] = float(L.m_Range)
    if typ == "spot":
        outer = math.radians(float(L.m_SpotAngle)) / 2
        entry["spot"] = {"innerConeAngle": outer * 0.8, "outerConeAngle": outer}
    lights_ext.append(entry)
    mk = marker_from_tid(tid)
    markers["lights"].append({"name": go.m_Name, "type": typ, "color": [round(v, 4) for v in (c.r, c.g, c.b)],
                              "unityIntensity": float(L.m_Intensity), "unityRange": float(L.m_Range), **mk})
    # glTF lights point down -Z; Unity lights point down +Z -> rotate 180 deg about Y
    m = to_gltf_matrix(world_matrix(tid)) @ np.diag([-1.0, 1.0, -1.0, 1.0])
    tr, q, _ = mat_to_trs(m)
    marker_nodes.append({"name": "LIGHT_" + go.m_Name, "translation": tr, "rotation": q,
                         "extensions": {"KHR_lights_punctual": {"light": len(lights_ext) - 1}}})

for key in ("host", "guest", "camera", "stageCenter"):
    mk = markers.get(key)
    if mk:
        n = {"name": mk["name"], "translation": mk["position"], "extras": {"marker": key}}
        if "quaternion" in mk: n["rotation"] = mk["quaternion"]
        marker_nodes.append(n)
for group in ("audience", "toiletSeats", "randomSpawns"):
    for mk in markers[group]:
        marker_nodes.append({"name": mk["name"], "translation": mk["position"], "rotation": mk["quaternion"],
                             "extras": {"marker": group}})

mk_root = glb.add_node({"name": "Markers", "children": [glb.add_node(n) for n in marker_nodes]})
glb.g["scenes"][0]["nodes"] = [geo_root, mk_root]
ext_used = set()
if lights_ext:
    glb.g["extensions"] = {"KHR_lights_punctual": {"lights": lights_ext}}
    ext_used.add("KHR_lights_punctual")
for m in glb.g["materials"]:
    ext_used.update(m.get("extensions", {}).keys())
    ext_used.update(m.get("pbrMetallicRoughness", {}).get("baseColorTexture", {}).get("extensions", {}).keys())
if ext_used:
    glb.g["extensionsUsed"] = sorted(ext_used)

out_glb = os.path.join(args.out, "tuurd_talk_stage.glb")
glb.write(out_glb)
with open(os.path.join(args.out, "tuurd_talk_markers.json"), "w") as f:
    json.dump(markers, f, indent=1)
print(f"wrote {out_glb} ({os.path.getsize(out_glb)/1e6:.1f} MB): {len(glb.g['meshes'])} meshes, "
      f"{len(glb.g['materials'])} materials, {len(glb.g['images'])} images, {len(glb.g['nodes'])} nodes")
print(f"markers: host={markers['host'] is not None} audience={len(markers['audience'])} "
      f"toiletSeats={len(markers['toiletSeats'])} spawns={len(markers['randomSpawns'])} lights={len(markers['lights'])}")

# ------------------------------------------------------------------ show background images
# The game shows StreamingAssets/ShowBgImages/TuurdTalk/*.png on the BgImageHolder1 screen.
bg_src = os.path.join(data_dir, "StreamingAssets", "ShowBgImages", "TuurdTalk")
bg_out = os.path.join(args.out, "show_bg")
if os.path.isdir(bg_src):
    os.makedirs(bg_out, exist_ok=True)
    names = []
    for fn in sorted(os.listdir(bg_src)):
        if fn.lower().endswith(".png"):
            im = Image.open(os.path.join(bg_src, fn)).convert("RGB")
            im.thumbnail((1280, 1280), Image.LANCZOS)
            name = os.path.splitext(fn)[0] + ".jpg"
            im.save(os.path.join(bg_out, name), "JPEG", quality=85)
            names.append(name)
    with open(os.path.join(bg_out, "index.json"), "w") as f:
        json.dump(names, f)
    print(f"show backgrounds: {len(names)} -> {bg_out}")
