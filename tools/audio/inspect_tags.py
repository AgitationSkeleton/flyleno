"""Debug helper: print top AudioSet labels over a time range.
usage: inspect_tags.py VID STEM T0 T1 [step]"""
import sys
import numpy as np
from transformers import AutoConfig
from common import SRC
from s04_tag import MODEL
L = AutoConfig.from_pretrained(MODEL).id2label
vid, st, t0, t1 = sys.argv[1], sys.argv[2], float(sys.argv[3]), float(sys.argv[4])
step = float(sys.argv[5]) if len(sys.argv) > 5 else 0.5
d = np.load(SRC / "tags" / f"{vid}_{st}.npz"); t = d["t"]; P = d["p"].astype(float)
for i in np.where((t >= t0) & (t <= t1))[0]:
    if abs((t[i] - t0) / step - round((t[i] - t0) / step)) > 1e-3:
        continue
    o = np.argsort(-P[i])[:5]
    print("%7.2f  " % t[i] + "  ".join("%s:%.2f" % (L[k][:18], P[i, k]) for k in o))
