"""Step 7: show SFX and crowd sounds.

Events are found in the precomputed AST window probabilities (s04) of the full mix, the
vocals stem and the non-vocal stem. For each category a label group is summed; a window is a
candidate only if the group is the top label or dominates every other label (excluding the
generic "Sound effect") by DOM. Boundaries are refined on the energy envelope of the stem
the event was found in (onset = where the envelope rises out of the floor before the peak,
end = where it decays 40 dB below the peak, or the group stops firing for sustained sounds).
The cut clip is re-tagged by AST and kept only if the group is still the top label and >= half
of its detection score. Clips are LUFS-normalised (-18 LUFS, peak <= -1 dBFS) and written as Opus.

AudioSet has no Vomit / Retching / Booing classes; see CATS for the stand-ins used and the
README for what was (not) found.  Output: _src/audio/units/sfx_units.json"""
import shutil
from collections import defaultdict

import numpy as np

from common import SRC, OUT, IDS, SFX_SOURCES, load, jdump
from audio_utils import SR, audio, cut, frame_rms, energy_bounds, lufs_normalize, median_f0, encode_ogg, Tags
from s04_tag import load_model, tag_array

# category -> (group labels, stems searched, min group prob, kind, max clips, max dur s)
CATS = {
    ("sfx", "retch"): (["Burping, eructation", "Gargling", "Retching"], ["vocals", "mix"], 0.30, "impact", 4, 1.6),
    ("sfx", "vomit"): (["Splash, splatter", "Liquid", "Pour", "Gurgling", "Squish", "Vomit"],
                       ["no_vocals", "mix", "vocals"], 0.30, "impact", 4, 2.0),
    ("sfx", "fart"): (["Fart"], ["mix", "vocals", "no_vocals"], 0.25, "impact", 4, 1.5),
    ("sfx", "splat"): (["Splash, splatter", "Squish", "Slap, smack", "Whack, thwack"],
                       ["no_vocals", "mix"], 0.15, "impact", 3, 0.8),
    ("crowd", "boo"): (["Booing"], ["mix", "no_vocals"], 0.30, "sustained", 4, 4.0),
    ("crowd", "gasp"): (["Gasp"], ["no_vocals", "mix"], 0.35, "impact", 4, 1.2),
    ("crowd", "cheer"): (["Cheering", "Whoop"], ["mix", "no_vocals"], 0.30, "sustained", 4, 4.0),
    ("crowd", "laugh"): (["Laughter", "Belly laugh", "Giggle", "Chuckle, chortle", "Snicker"],
                         ["no_vocals", "mix"], 0.30, "sustained", 4, 4.0),
    ("crowd", "applause"): (["Applause", "Clapping"], ["no_vocals", "mix"], 0.45, "sustained", 8, 4.0),
}
DOM = 1.5            # group prob must beat every non-group label by this factor (unless top-1)
IGNORE = {"Sound effect", "Inside, small room", "Inside, large room or hall"}
SPEECH = ["Speech", "Male speech, man speaking", "Female speech, woman speaking", "Narration, monologue"]


def group_prob(tags, P, names):
    ids = [tags.idx[n] for n in names if n in tags.idx]
    return P[..., ids].sum(-1) if ids else np.zeros(P.shape[:-1])


def dominance(tags, p, names):
    ids = {tags.idx[n] for n in names if n in tags.idx}
    other = [p[i] for i in range(len(p)) if i not in ids and tags.labels[i] not in IGNORE]
    g = sum(p[i] for i in ids)
    top1 = tags.labels[int(np.argmax(p))] in names
    return g, g / (max(other) + 1e-6), top1


def refine_impact(x, t0, t1, maxdur, hop=0.005):
    """Onset/offset on the energy envelope inside [t0-0.3, t1+0.3]."""
    a0 = max(0.0, t0 - 0.3)
    seg = x[int(a0 * SR):int((t1 + 0.3) * SR)]
    r = 20 * np.log10(frame_rms(seg, SR, hop))
    pk = int(np.argmax(r))
    floor = np.percentile(r, 10)
    thr_on = max(floor + 6, r[pk] - 30)
    s = pk
    while s > 0 and r[s - 1] > thr_on:
        s -= 1
    e = pk
    while e + 1 < len(r) and r[e + 1] > max(r[pk] - 40, floor + 3):
        e += 1
    s0, e0 = a0 + max(0, s - 2) * hop, a0 + (e + 1) * hop
    return s0, min(e0, s0 + maxdur)


def retag(y, fe, model):
    """AST probabilities of a whole clip (zero-padded to >= 1 s)."""
    import librosa
    y16 = librosa.resample(np.asarray(y, np.float32), orig_sr=SR, target_sr=16000)
    if len(y16) < 16000:
        pad = 16000 - len(y16)
        y16 = np.pad(y16, (pad // 2, pad - pad // 2))
    _, P = tag_array(y16, 16000, fe, model, win=len(y16) / 16000, hop=10.0)
    return P[0].astype(np.float32)


def fine_localize(x, t, names, tags, fe, model, win=0.5, hop=0.05):
    """Scan [t-0.25, t+1.25] with short AST windows; return the span where the group
    probability stays >= 50 % of its maximum (the event itself, not the loudest sound)."""
    import librosa
    a0 = max(0.0, t - 0.25)
    seg = librosa.resample(x[int(a0 * SR):int((t + 1.25) * SR)], orig_sr=SR, target_sr=16000)
    ts, P = tag_array(seg, 16000, fe, model, win=win, hop=hop)
    g = group_prob(tags, P.astype(np.float32), names)
    k = int(np.argmax(g))
    lo = hi = k
    while lo > 0 and g[lo - 1] >= 0.5 * g[k]:
        lo -= 1
    while hi + 1 < len(g) and g[hi + 1] >= 0.5 * g[k]:
        hi += 1
    return a0 + ts[lo], a0 + ts[hi] + win, float(g[k])


def refine_sustained(t, g, i, thr, maxdur):
    """Extend around window i while the group keeps firing (>= 0.6 thr); window = 1 s."""
    lo = hi = i
    while lo > 0 and g[lo - 1] >= 0.6 * thr:
        lo -= 1
    while hi + 1 < len(g) and g[hi + 1] >= 0.6 * thr:
        hi += 1
    a, b = t[lo] + 0.25, t[hi] + 0.75           # inner part of the covered windows
    if b - a > maxdur:                           # centre on the strongest window
        c = t[i] + 0.5
        a, b = max(a, c - maxdur / 2), min(b, c + maxdur / 2)
    return a, b


def main():
    tags = Tags()
    fe, model = load_model()
    from audio_utils import Speaker
    spk = Speaker()
    out = {"sfx": defaultdict(list), "crowd": defaultdict(list)}
    log = {}
    for (grp, cat), (names, stems, thr, kind, nmax, maxdur) in CATS.items():
        cands = []
        for vid in IDS:
            for st in stems:
                t, P = tags.get(vid, st)
                g = group_prob(tags, P, names)
                for i in np.argsort(-g):
                    if g[i] < thr:
                        break
                    gp, dom, top1 = dominance(tags, P[i], names)
                    sp = float(sum(P[i, tags.idx[n]] for n in SPEECH))
                    if not (top1 or dom >= DOM):
                        continue
                    if st != "vocals" and sp > gp:
                        continue
                    cands.append({"vid": vid, "stem": st, "i": int(i), "t": float(t[i]), "g": float(gp),
                                  "dom": float(dom), "speech": sp})
        cands.sort(key=lambda c: -(c["g"] * min(c["dom"], 3)))
        kept, tested = [], 0
        for c in cands:
            if len(kept) >= nmax:
                break
            if any(k["vid"] == c["vid"] and abs(k["t"] - c["t"]) < 1.5 for k in kept):
                continue
            # same event already used by another category?
            if any(k["vid"] == c["vid"] and abs(k["t"] - c["t"]) < 1.0
                   for g2 in out.values() for lst in g2.values() for k in lst):
                continue
            x = audio(c["vid"], c["stem"])
            if kind == "impact":
                # candidate spans around the event; keep the one AST re-tags best (target top-1,
                # largest margin over the runner-up label, shorter preferred on ties)
                fa, fb, c["g_fine"] = fine_localize(x, c["t"], names, tags, fe, model)
                spans = [(fa, fb), (fa - 0.1, fb + 0.1), (fa - 0.2, fb + 0.2),
                         (c["t"] + 0.2, c["t"] + 0.8), (c["t"], c["t"] + 1.0)]
                best = None
                for sa, sb in spans:
                    sa = max(0.0, sa)
                    ea, eb = energy_bounds(x, sa, sb, -35)
                    if eb - ea < 0.08:
                        continue
                    ea, eb = ea, min(eb, ea + maxdur)
                    yy, ya, yb = cut(x, ea, eb, fade=0.01)
                    pq = retag(yy, fe, model)
                    order = np.argsort(-pq)
                    gq = float(group_prob(tags, pq, names))
                    rest = [pq[k] for k in order if tags.labels[k] not in names and tags.labels[k] not in IGNORE]
                    margin = gq / (rest[0] + 1e-6)
                    ok = tags.labels[order[0]] in names and gq >= 0.5 * c["g"]
                    if ok and (best is None or margin > best[0] * 1.1):
                        best = (margin, yy, ya, yb, pq, gq)
                tested += 1
                if best is None:
                    continue
                _, y, a, b, pq, gq = best
                c["dom"] = min(c["dom"], best[0])
                top3 = [tags.labels[k] for k in np.argsort(-pq)[:3]]
            else:
                t, P = tags.get(c["vid"], c["stem"])
                a, b = refine_sustained(t, group_prob(tags, P, names), c["i"], thr, maxdur)
                if b - a < 0.08:
                    continue
                y, a, b = cut(x, a, b, fade=0.08)
                tested += 1
                pq = retag(y, fe, model)
                gq = float(group_prob(tags, pq, names))
                top3 = [tags.labels[k] for k in np.argsort(-pq)[:3]]
                if gq < 0.5 * c["g"] or top3[0] not in names:     # target must be the top label
                    continue
            conf = float(min(1.0, np.sqrt(gq * min(c["dom"], 3) / 3) * 1.2))
            if grp == "crowd" and cat in ("laugh", "gasp", "cheer", "boo"):
                # a studio crowd is many voices: reject Leno himself, down-weight single voices
                c["leno_sim"] = spk.sim(audio(c["vid"], "vocals")[int(a * SR):int(max(b, a + 1.0) * SR)])
                if c["leno_sim"] >= 0.3:
                    continue
                crowdish = float(sum(pq[tags.idx[n]] for n in ("Crowd", "Hubbub, speech noise, speech babble",
                                                                    "Chatter", "Applause", "Cheering")))
                c["crowdish"] = crowdish
                if crowdish < 0.15:
                    conf *= 0.6
            y, r = lufs_normalize(y, -18.0)
            c.update(y=y, a=a, b=b, rms=r, qc_g=gq, qc_top3=top3, conf=round(conf, 3))
            kept.append(c)
        out[grp][cat] = kept
        log[f"{grp}/{cat}"] = {"candidates": len(cands), "tested": tested, "kept": len(kept)}
        print(f"{grp}/{cat}: {len(cands)} candidate windows, {tested} cut+re-tagged, {len(kept)} kept")

    # ---- metal pipe (dedicated SFX source)
    pid = SFX_SOURCES[0]["id"]
    x, _ = load(SRC / f"{pid}.wav", sr=SR)
    r = 20 * np.log10(frame_rms(x, SR, 0.005))
    pk = int(np.argmax(r > r.max() - 20))            # first frame within 20 dB of the max = transient
    s = pk
    while s > 0 and r[s - 1] > r.max() - 45:
        s -= 1
    on = max(0, s - 1) * 0.005
    live = np.where(r > r.max() - 50)[0]
    end = (live[-1] + 1) * 0.005
    pipe = []
    import librosa
    for dur, fo in ((end - on, 0.12), (1.2, 0.35), (0.55, 0.2)):
        y, a, b = cut(x, on, min(end, on + dur), fade=0.004)
        n = int(fo * SR)
        y[-n:] *= np.linspace(1, 0, n) ** 2                  # natural-sounding ring-out tail
        top3 = [tags.labels[k] for k in np.argsort(-retag(y, fe, model))[:3]]
        y, rr = lufs_normalize(y, -18.0)
        pipe.append({"vid": pid, "stem": "mix", "y": y, "a": a, "b": b, "rms": rr, "qc_top3": top3,
                     "g": 1.0, "dom": 3.0, "conf": 1.0})
    out["sfx"]["pipe"] = pipe
    log["sfx/pipe"] = {"kept": len(pipe), "note": "single impact; 3 lengths of the same hit"}
    print("sfx/pipe:", len(pipe), [p["qc_top3"] for p in pipe])

    # ---- write
    res = {"sfx": {}, "crowd": {}, "log": log}
    for grp in ("sfx", "crowd"):
        for cat, lst in out[grp].items():
            d = OUT / grp / cat
            if d.exists():
                shutil.rmtree(d)
            res[grp][cat] = []
            for i, c in enumerate(sorted(lst, key=lambda c: -c["conf"]), 1):
                rel = f"{grp}/{cat}/{cat}_{i:03d}.ogg"
                encode_ogg(c["y"], OUT / rel, bitrate="96k")
                f0 = median_f0(c["y"]) if cat in ("retch", "gasp", "laugh") else None
                res[grp][cat].append({
                    "file": rel, "dur": round(len(c["y"]) / SR, 3), "rms": round(c["rms"], 4), "f0": f0,
                    "src": {"video": c["vid"], "t0": round(c["a"], 3), "t1": round(c["b"], 3)},
                    "conf": c["conf"],
                    "_qc": {"stem": c["stem"], "det_prob": round(c["g"], 3), "dominance": round(c["dom"], 2),
                            **({"leno_sim": round(c["leno_sim"], 3), "crowdish": round(c["crowdish"], 3)}
                               if "leno_sim" in c else {}),
                            "retag_prob": round(c.get("qc_g", 1.0), 3), "retag_top3": c["qc_top3"]}})
    jdump(res, SRC / "units" / "sfx_units.json")


if __name__ == "__main__":
    main()
