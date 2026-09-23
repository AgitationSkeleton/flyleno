"""Step 3: speaker embeddings (SpeechBrain ECAPA) over word-grouped speech chunks,
agglomerative clustering, and selection of the Grey Leno cluster.

Leno cluster = the cluster that (a) holds most of the candidacy-announcement chunks
(that clip is a Leno monologue) and (b) holds most host speech in the show.
Chunks are then scored by cosine similarity to the Leno centroid (refined over
confidently-Leno chunks) and written to _src/audio/diar/leno_segments.json."""
import sys
import numpy as np
import torch
from sklearn.cluster import AgglomerativeClustering
from speechbrain.inference.speaker import EncoderClassifier
from speechbrain.utils.fetching import LocalStrategy
from common import SRC, IDS, stem, load, jdump, jload

GAP = 0.35      # split word groups at pauses longer than this
MAXLEN = 4.0    # max chunk length (s)
LENO_SIM = 0.50  # cosine sim to refined Leno centroid to accept a chunk
LENO_MIN = 0.40  # absolute floor even for cluster members
DIST = float(sys.argv[1]) if len(sys.argv) > 1 else 0.70   # cosine distance threshold

def chunks_from_words(segs):
    words = [w for s in segs for w in s["words"] if w["t1"] > w["t0"]]
    out, cur = [], []
    for w in words:
        if cur and (w["t0"] - cur[-1]["t1"] > GAP or w["t1"] - cur[0]["t0"] > MAXLEN):
            out.append(cur); cur = []
        cur.append(w)
    if cur: out.append(cur)
    return [{"t0": c[0]["t0"], "t1": c[-1]["t1"], "text": " ".join(w["w"] for w in c),
             "words": c} for c in out]

def main():
    enc = EncoderClassifier.from_hparams("speechbrain/spkrec-ecapa-voxceleb",
                                         savedir=str(SRC / "models" / "ecapa"),
                                         run_opts={"device": "cuda"},
                                         local_strategy=LocalStrategy.COPY)
    allc, embs = [], []
    for vid in IDS:
        x, sr = load(stem(vid, "vocals"), sr=16000)
        segs = jload(SRC / "transcripts" / f"{vid}.json")["segments"]
        for c in chunks_from_words(segs):
            a, b = int(c["t0"] * sr), int(c["t1"] * sr)
            if b - a < int(0.3 * sr):
                continue
            seg = x[a:b]
            with torch.no_grad():
                e = enc.encode_batch(torch.from_numpy(seg)[None].cuda()).squeeze().cpu().numpy()
            c["vid"] = vid
            c["dur"] = c["t1"] - c["t0"]
            allc.append(c); embs.append(e / np.linalg.norm(e))
    E = np.stack(embs)
    np.save(SRC / "diar_embs.npy", E)
    dur = np.array([c["dur"] for c in allc])
    long_ = dur >= 1.0          # cluster on reliable (>=1 s) chunks only
    cl = AgglomerativeClustering(n_clusters=None, metric="cosine", linkage="average",
                                 distance_threshold=DIST).fit(E[long_])
    labs = -np.ones(len(allc), int); labs[long_] = cl.labels_
    # summarize clusters
    stats = []
    for k in np.unique(cl.labels_):
        m = labs == k
        dc = sum(d for d, c, mm in zip(dur, allc, m) if mm and c["vid"] == IDS[0])
        ds = sum(d for d, c, mm in zip(dur, allc, m) if mm and c["vid"] == IDS[1])
        stats.append((k, int(m.sum()), dc, ds))
    stats.sort(key=lambda s: -(s[2] + s[3]))
    for k, n, dc, ds in stats[:12]:
        txt = [c["vid"][:2] + "@%.0f:" % c["t0"] + c["text"][:40] for c, l in zip(allc, labs) if l == k][:4]
        print(f"cluster {k}: n={n} cand={dc:.1f}s show={ds:.1f}s | " + " || ".join(txt))
    # Leno = cluster with max candidacy speech (tie-break total)
    lk = max(stats, key=lambda s: (s[2], s[3]))[0]
    cen = E[labs == lk].mean(0); cen /= np.linalg.norm(cen)
    sim = E @ cen
    # refine centroid on confident members
    conf_m = (labs == lk) & (sim > np.percentile(sim[labs == lk], 25))
    cen = E[conf_m].mean(0); cen /= np.linalg.norm(cen)
    sim = E @ cen
    np.save(SRC / "leno_centroid.npy", cen)
    others = [s[0] for s in stats if s[0] != lk]
    oc = {int(k): (lambda v: v / np.linalg.norm(v))(E[labs == k].mean(0)) for k in others if (labs == k).sum() >= 3}
    for i, c in enumerate(allc):
        c["cluster"] = int(labs[i]); c["sim_leno"] = float(sim[i])
        c["sim_other"] = float(max([E[i] @ v for v in oc.values()], default=0.0))
        c.pop("words_", None)
    tot = {v: sum(c["dur"] for c in allc if c["vid"] == v) for v in IDS}
    lenod = {v: sum(c["dur"] for c in allc if c["vid"] == v and c["cluster"] == lk) for v in IDS}
    print("leno cluster", lk, "speech s per video:", lenod, "of", tot)
    # Leno segments: in the Leno cluster or close to its centroid, and not closer to another voice
    leno = [c for c in allc if c["dur"] >= 0.6 and (c["cluster"] == lk or c["sim_leno"] >= LENO_SIM)
            and c["sim_leno"] >= LENO_MIN and c["sim_leno"] > c["sim_other"] - 0.25]
    for c in leno:
        c["conf"] = float(np.clip((c["sim_leno"] - 0.3) / 0.5, 0, 1))
    print("leno segments:", len(leno), "total %.1fs" % sum(c["dur"] for c in leno))
    jdump({"centroid_threshold": LENO_SIM, "segments": leno}, SRC / "diar" / "leno_segments.json")
    jdump({"leno_cluster": int(lk), "dist_threshold": DIST, "clusters": [list(map(float, s)) for s in stats],
           "chunks": allc}, SRC / "diar" / "chunks.json")

if __name__ == "__main__":
    main()
