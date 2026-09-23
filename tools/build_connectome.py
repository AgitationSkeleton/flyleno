"""
Build the browser brain data for FlyLeno from the Shiu et al. (2024) whole-brain LIF model inputs
(FlyWire v783) + FlyWire neuron annotations.

Inputs (defaults point at the cloned sources in D:/Claude_FruitFly/sources):
  philshiu__Drosophila_brain_model/Completeness_783.csv       neuron order (index -> root id)
  philshiu__Drosophila_brain_model/Connectivity_783.parquet   pre/post index, signed synapse count
  flyconnectome__flywire_annotations/supplemental_files/Supplemental_file1_neuron_annotations.tsv
  tools/neuron_groups.json                                    stimulus + motor groups (root ids)

Outputs (data/):
  connectome.bin.gz   "FLYL" v1 CSR (see format below), gzip
  neurons.json        per-neuron super class codes, group index lists, metadata

Binary format (little endian, before gzip):
  char[4] "FLYL" | u32 version=1 | u32 N | u32 E | u32 min_syn
  u32[N+1] row offsets (edge index)
  varint stream: for each source row, targets as LEB128 deltas (first delta from 0)
  varint stream: for each edge, zigzag-LEB128 signed synapse count (Excitatory x Connectivity)
  Each stream is preceded by its u32 byte length.

    python tools/build_connectome.py [--min-syn 1]
"""
import argparse
import gzip
import json
import os
import struct

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = r"D:\Claude_FruitFly\sources"
ap = argparse.ArgumentParser()
ap.add_argument("--shiu", default=os.path.join(SRC, "philshiu__Drosophila_brain_model"))
ap.add_argument("--annotations", default=os.path.join(SRC, "flyconnectome__flywire_annotations", "supplemental_files",
                                                      "Supplemental_file1_neuron_annotations.tsv"))
ap.add_argument("--groups", default=os.path.join(HERE, "neuron_groups.json"))
ap.add_argument("--out", default=os.path.join(HERE, "..", "data"))
ap.add_argument("--min-syn", type=int, default=1, help="drop connections with fewer synapses (1 = keep all, as Shiu)")
args = ap.parse_args()
os.makedirs(args.out, exist_ok=True)


def leb128(values: np.ndarray) -> bytes:
    """Vectorised unsigned LEB128 encoding of a uint64 array."""
    v = values.astype(np.uint64)
    nbytes = np.ones(len(v), dtype=np.int64)
    t = v >> np.uint64(7)
    while t.any():
        nbytes += (t > 0)
        t >>= np.uint64(7)
    total = int(nbytes.sum())
    out = np.empty(total, dtype=np.uint8)
    starts = np.concatenate([[0], np.cumsum(nbytes)[:-1]])
    cur = v.copy()
    for k in range(int(nbytes.max())):
        mask = nbytes > k
        idx = starts[mask] + k
        byte = (cur[mask] & np.uint64(0x7F)).astype(np.uint8)
        more = nbytes[mask] > k + 1
        byte[more] |= 0x80
        out[idx] = byte
        cur[mask] >>= np.uint64(7)
    return out.tobytes()


comp = pd.read_csv(os.path.join(args.shiu, "Completeness_783.csv"), index_col=0)
root_ids = comp.index.values.astype(np.int64)
N = len(root_ids)
idx_of = {int(r): i for i, r in enumerate(root_ids)}
print("neurons", N)

con = pd.read_parquet(os.path.join(args.shiu, "Connectivity_783.parquet"),
                      columns=["Presynaptic_Index", "Postsynaptic_Index", "Connectivity", "Excitatory x Connectivity"])
if args.min_syn > 1:
    con = con[con["Connectivity"] >= args.min_syn]
con = con.sort_values(["Presynaptic_Index", "Postsynaptic_Index"], kind="stable")
pre = con["Presynaptic_Index"].values.astype(np.int64)
post = con["Postsynaptic_Index"].values.astype(np.int64)
w = con["Excitatory x Connectivity"].values.astype(np.int64)
E = len(pre)
print("edges", E, "synapses", int(np.abs(w).sum()))

offsets = np.zeros(N + 1, dtype=np.uint32)
np.add.at(offsets, pre + 1, 1)
offsets = np.cumsum(offsets).astype(np.uint32)
# target deltas restart at each row
delta = post.copy()
row_start = np.zeros(E, dtype=bool)
row_start[offsets[:-1][np.diff(offsets) > 0]] = True
delta[1:] = post[1:] - post[:-1]
delta[row_start] = post[row_start]
assert (delta >= 0).all()
tgt_stream = leb128(delta)
zz = ((w << 1) ^ (w >> 63)).astype(np.uint64)
w_stream = leb128(zz)

raw = b"FLYL" + struct.pack("<IIII", 1, N, E, args.min_syn) + offsets.tobytes()
raw += struct.pack("<I", len(tgt_stream)) + tgt_stream + struct.pack("<I", len(w_stream)) + w_stream
with gzip.open(os.path.join(args.out, "connectome.bin.gz"), "wb", compresslevel=9) as f:
    f.write(raw)
print(f"connectome.bin.gz: raw {len(raw)/1e6:.1f} MB -> {os.path.getsize(os.path.join(args.out, 'connectome.bin.gz'))/1e6:.1f} MB")

# ---------------------------------------------------------------- annotations
ann = pd.read_csv(args.annotations, sep="\t", usecols=["root_id", "super_class", "cell_class", "cell_sub_class", "cell_type", "side", "nerve"],
                  dtype={"root_id": np.int64}, low_memory=False)
ann = ann.drop_duplicates("root_id").set_index("root_id")
ann = ann.reindex(root_ids)
sc = ann["super_class"].fillna("unknown")
classes = sorted(sc.unique().tolist())
class_code = sc.map({c: i for i, c in enumerate(classes)}).values.astype(np.uint8)
print("super classes:", dict(zip(*np.unique(sc, return_counts=True))))

groups_in = json.load(open(args.groups, encoding="utf-8"))
groups_out = {}


def resolve(g):
    """root ids of a group: explicit 'root_ids' or an annotation 'query'."""
    if "root_ids" in g:
        return [int(r) for r in g["root_ids"]]
    q = g["query"]
    m = pd.Series(True, index=ann.index)
    if "super_class" in q: m &= ann["super_class"].isin(q["super_class"])
    if "cell_class" in q: m &= ann["cell_class"].isin(q["cell_class"])
    if "nerve" in q: m &= ann["nerve"].isin(q["nerve"])
    if "side" in q: m &= ann["side"].isin(q["side"])
    if "cell_sub_class" in q: m &= ann["cell_sub_class"].isin(q["cell_sub_class"])
    if "cell_type_exact" in q: m &= ann["cell_type"].isin(q["cell_type_exact"])
    if "cell_type_prefix" in q:
        ct = ann["cell_type"].fillna("")
        m &= ct.apply(lambda t: any(t.startswith(pfx) for pfx in q["cell_type_prefix"]))
    if "exclude_cell_type" in q: m &= ~ann["cell_type"].isin(q["exclude_cell_type"])
    if "exclude_cell_type_prefix" in q:
        ct = ann["cell_type"].fillna("")
        m &= ~ct.apply(lambda t: any(t.startswith(pfx) for pfx in q["exclude_cell_type_prefix"]))
    return [int(r) for r in ann.index[m.values]]


for kind in ("stimuli", "motor", "readouts"):
    groups_out[kind] = []
    for g in groups_in.get(kind, []):
        ids = resolve(g)
        idx = [idx_of[r] for r in ids if r in idx_of]
        missing = [r for r in ids if r not in idx_of]
        if missing:
            print(f"  ! {g['key']}: {len(missing)} root ids not in v783 completeness list")
        types = sorted(set(str(t) for t in ann.loc[[r for r in ids if r in idx_of], "cell_type"].dropna()))
        entry = {k: v for k, v in g.items() if k not in ("root_ids", "query")} | {"indices": idx, "cellTypes": types}
        if kind == "readouts":
            entry["neuronTypes"] = [str(ann.loc[root_ids[i], "cell_type"]) for i in idx]
            entry["neuronNerves"] = [str(ann.loc[root_ids[i], "nerve"]) for i in idx]
        groups_out[kind].append(entry)
        print(f"  {kind}/{g['key']}: {len(idx)} neurons {types[:6]}")

# ---------------------------------------------------------------- muscle pools (ragdoll)
# Every descending neuron (except the command DNs used above) is assigned to one of Leno's muscles.
# Assignment is by cell type (stable hash), so the left and right copies of a bilateral type drive
# the mirrored muscles, and midline types drive axial muscles.
import zlib
body = json.load(open(os.path.join(HERE, "body_spec.json"), encoding="utf-8"))
slots = []   # (kind, joint, dof) ; kind 'axial' or 'lateral'
for j in body["axial"]:
    for d in j["dofs"]: slots.append(("axial", j["joint"], d))
for j in body["lateral"]:
    for d in j["dofs"]: slots.append(("lateral", j["joint"], d))
muscles = {}
def add(name, i): muscles.setdefault(name, []).append(i)
dn = ann[(ann["super_class"] == "descending")]
excl = tuple(body["excludeDnTypes"])
for r, row in dn.iterrows():
    t = str(row["cell_type"]) if pd.notna(row["cell_type"]) else f"untyped_{r}"
    if t.startswith(excl) or r not in idx_of:
        continue
    h = zlib.crc32(t.encode())
    kind, joint, dof = slots[h % len(slots)]
    role = "flex" if (h >> 8) % 2 == 0 else "ext"
    if kind == "axial":
        add(f"{joint}_{dof}_{role}", idx_of[r])
    else:
        side = {"left": "l", "right": "r"}.get(str(row["side"]), "l" if (h >> 9) % 2 else "r")
        add(f"{joint}_{side}_{dof}_{role}", idx_of[r])
# make sure every muscle exists (possibly empty)
for kind, joint, dof in slots:
    for role in ("flex", "ext"):
        if kind == "axial": muscles.setdefault(f"{joint}_{dof}_{role}", [])
        else:
            for side in ("l", "r"): muscles.setdefault(f"{joint}_{side}_{dof}_{role}", [])
print("muscles:", len(muscles), "DNs assigned:", sum(len(v) for v in muscles.values()),
      "min/max per muscle:", min(len(v) for v in muscles.values()), max(len(v) for v in muscles.values()))

meta = {
    "source": "Shiu et al. 2024 (Nature) whole-brain LIF model, FlyWire v783; annotations Schlegel et al. 2024",
    "N": N, "E": E, "synapses": int(np.abs(w).sum()), "minSyn": args.min_syn,
    "superClasses": classes,
    "superClass": class_code.tolist(),
    "params": {"v0": -52.0, "vReset": -52.0, "vTh": -45.0, "tMbr": 20.0, "tau": 5.0, "tRef": 2.2, "tDelay": 1.8,
               "wSyn": 0.275, "dt": 0.1},
    **groups_out,
    "muscles": [{"key": k, "indices": v} for k, v in sorted(muscles.items())],
}
with open(os.path.join(args.out, "neurons.json"), "w") as f:
    json.dump(meta, f, separators=(",", ":"))
print("neurons.json", os.path.getsize(os.path.join(args.out, "neurons.json")) / 1e6, "MB")

# ---------------------------------------------------------------- positions (neural map)
# Measured soma position where annotated, else the annotation's representative point (pos_x/y/z),
# else a deterministic layout: the centroid of the neuron's super-class + hashed jitter.
pos = pd.read_csv(args.annotations, sep="	", usecols=["root_id", "soma_x", "soma_y", "soma_z", "pos_x", "pos_y", "pos_z"],
                  dtype={"root_id": np.int64}, low_memory=False).drop_duplicates("root_id").set_index("root_id").reindex(root_ids)
xyz = pos[["soma_x", "soma_y", "soma_z"]].to_numpy(float)
src = np.where(np.isfinite(xyz).all(axis=1), 0, 1).astype(np.uint8)       # 0 soma, 1 pos, 2 layout
alt = pos[["pos_x", "pos_y", "pos_z"]].to_numpy(float)
xyz[src == 1] = alt[src == 1]
bad = ~np.isfinite(xyz).all(axis=1)
src[bad] = 2
cls = class_code
for c in np.unique(cls[bad]):
    ok = (cls == c) & ~bad
    centre = xyz[ok].mean(axis=0) if ok.any() else np.nanmean(xyz[~bad], axis=0)
    spread = xyz[ok].std(axis=0) * 0.5 if ok.sum() > 1 else np.array([2e3, 2e3, 2e3])
    for i in np.flatnonzero(bad & (cls == c)):
        h = zlib.crc32(str(root_ids[i]).encode())
        rnd = np.array([(h & 1023) / 1023, ((h >> 10) & 1023) / 1023, ((h >> 20) & 1023) / 1023]) * 2 - 1
        xyz[i] = centre + rnd * spread
lo, hi = xyz.min(axis=0), xyz.max(axis=0)
centre, half = (lo + hi) / 2, (hi - lo).max() / 2
q = np.round((xyz - centre) / half * 32767).astype(np.int16)
with gzip.open(os.path.join(args.out, "positions.bin.gz"), "wb", compresslevel=9) as f:
    f.write(b"FLYP" + struct.pack("<If", N, float(half)) + q.tobytes() + src.tobytes())
print("positions: soma", int((src == 0).sum()), "pos", int((src == 1).sum()), "layout", int((src == 2).sum()),
      "->", os.path.getsize(os.path.join(args.out, "positions.bin.gz")) / 1e6, "MB")
