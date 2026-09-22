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
ann = pd.read_csv(args.annotations, sep="\t", usecols=["root_id", "super_class", "cell_class", "cell_type", "side"],
                  dtype={"root_id": np.int64}, low_memory=False)
ann = ann.drop_duplicates("root_id").set_index("root_id")
ann = ann.reindex(root_ids)
sc = ann["super_class"].fillna("unknown")
classes = sorted(sc.unique().tolist())
class_code = sc.map({c: i for i, c in enumerate(classes)}).values.astype(np.uint8)
print("super classes:", dict(zip(*np.unique(sc, return_counts=True))))

groups_in = json.load(open(args.groups, encoding="utf-8"))
groups_out = {}
for kind in ("stimuli", "motor"):
    groups_out[kind] = []
    for g in groups_in[kind]:
        ids = [int(r) for r in g["root_ids"]]
        idx = [idx_of[r] for r in ids if r in idx_of]
        missing = [r for r in ids if r not in idx_of]
        if missing:
            print(f"  ! {g['key']}: {len(missing)} root ids not in v783 completeness list")
        types = sorted(set(str(t) for t in ann.loc[[r for r in ids if r in idx_of], "cell_type"].dropna()))
        groups_out[kind].append({k: v for k, v in g.items() if k != "root_ids"} | {"indices": idx, "cellTypes": types})
        print(f"  {kind}/{g['key']}: {len(idx)} neurons {types[:6]}")

meta = {
    "source": "Shiu et al. 2024 (Nature) whole-brain LIF model, FlyWire v783; annotations Schlegel et al. 2024",
    "N": N, "E": E, "synapses": int(np.abs(w).sum()), "minSyn": args.min_syn,
    "superClasses": classes,
    "superClass": class_code.tolist(),
    "params": {"v0": -52.0, "vReset": -52.0, "vTh": -45.0, "tMbr": 20.0, "tau": 5.0, "tRef": 2.2, "tDelay": 1.8,
               "wSyn": 0.275, "dt": 0.1},
    **groups_out,
}
with open(os.path.join(args.out, "neurons.json"), "w") as f:
    json.dump(meta, f, separators=(",", ":"))
print("neurons.json", os.path.getsize(os.path.join(args.out, "neurons.json")) / 1e6, "MB")
