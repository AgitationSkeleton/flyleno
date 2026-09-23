"""Step 6: cut Grey Leno units (phonemes, syllables, mutters, words) from Leno-only regions.

Candidates come from the CTC phone timings (s05) and Whisper words (s02); every candidate
is cut from the Demucs vocals stem, gated on:
  * phone posterior (CTC) and separation SNR (vocal stem vs non-vocal stem, dB),
  * AST "Music" probability on the vocals stem (residual bleed),
  * re-recognition of the cut clip (wav2vec2 phonemes; Whisper for words),
  * ECAPA speaker similarity of the clip (and its +-0.6 s context) to the Leno centroid.
Survivors are ranked, de-duplicated, RMS-normalised, faded at zero crossings and written
as Opus .ogg. Results: _src/audio/units/leno_units.json (consumed by s08_manifest.py)."""
import re
import sys
from collections import defaultdict

import numpy as np

from common import SRC, OUT, IDS, jload, jdump
from phonemap import VOWELS, IPA2ARPA, IPA2ARPA_SEQ, to_arpa, romanize
from audio_utils import (SR, audio, cut, energy_bounds, normalize, median_f0, sep_snr_db,
                         encode_ogg, Tags, Speaker)
from s05_align import Recognizer

CONS_KEEP = ["B", "D", "G", "P", "T", "K", "F", "V", "S", "Z", "SH", "TH", "DH", "HH", "M", "N",
             "NG", "L", "R", "W", "Y", "CH", "JH"]
N_VOWEL, N_CONS, N_SYL, N_WORD = 8, 4, 70, 60
DIPH = {"AY", "EY", "OY", "AW", "OW"}
MONO = [v for v in VOWELS if v not in DIPH]
TARGET_RMS = 0.1          # -20 dBFS RMS for all Leno units
PAD = 0.15                # silence padding for re-recognition
INTERJ = {"huh": "uh", "uh": "uh", "um": "uh", "ah": "uh", "eh": "uh", "oh": "uh", "hmm": "hmm",
          "mm": "hmm", "mhm": "hmm", "er": "er", "erm": "er"}


def norm_word(w):
    return re.sub(r"[^a-z']", "", w.lower())


class QC:
    def __init__(self):
        self.rec = Recognizer()
        self.tok_of = defaultdict(list)   # ARPA -> vocab ids whose mapping starts with / is it
        for tid, tok in self.rec.inv.items():
            for a in to_arpa(tok):
                self.tok_of[a].append(tid)
        self.spk = Speaker()

    def phones(self, y):
        import librosa
        y16 = librosa.resample(y, orig_sr=SR, target_sr=16000)
        pad = np.zeros(int(PAD * 16000), np.float32)
        lp = self.rec.logprobs(np.concatenate([pad, y16, pad]))
        seq = [a for t in self.rec.tokens(lp) for a in to_arpa(t[0])]
        return seq, np.exp(lp)

    def vowel_rank(self, P):
        mass = {v: P[:, self.tok_of[v]].sum() for v in VOWELS}
        return sorted(VOWELS, key=lambda v: -mass[v])

    def ctx_check(self, vid, a, b, targets, seq_mode=False, ctx=0.25, tol=0.02):
        """Re-run the recognizer on the clip with +-ctx of natural context: the target
        phone(s) must be emitted with their CTC spike inside the cut [a, b]."""
        import librosa
        x = audio(vid, "vocals")
        s0 = max(0.0, a - ctx)
        y16 = librosa.resample(x[int(s0 * SR):int((b + ctx) * SR)], orig_sr=SR, target_sr=16000)
        lp = self.rec.logprobs(y16)
        inside = []
        for tok, pa, pb, tid, post in self.rec.tokens(lp):
            tc = s0 + (pa + pb) / 2 * 0.02
            if a - tol <= tc <= b + tol:
                inside += to_arpa(tok)
        if not seq_mode:
            return any(t in inside for t in targets)
        it = iter(inside)
        return all(t in it for t in targets) and len(inside) <= len(targets) + 1

    def target_post(self, P, arpa):
        ids = self.tok_of.get(arpa, [])
        return float(P[:, ids].sum(1).max()) if ids else 0.0


def edit(a, b):
    d = np.arange(len(b) + 1)
    for i, x in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, y in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (x != y))
    return int(d[-1])


def context_sim(qc, vid, t0, t1):
    x = audio(vid, "vocals")
    c = (t0 + t1) / 2
    a, b = max(0.0, min(t0, c - 0.6)), max(t1, c + 0.6)
    return qc.spk.sim(x[int(a * SR):int(b * SR)])


def make_clip(vid, t0, t1, trim=True, rel_db=-35):
    x = audio(vid, "vocals")
    if trim:
        t0, t1 = energy_bounds(x, t0, t1, rel_db)
    y, a, b = cut(x, t0, t1)
    return y, a, b


def vowel_nucleus(vid, t0, t1, diph=False, hop=0.005):
    """Steady part of a vowel inside [t0,t1]: longest run of frames within 8 dB (15 dB for
    diphthongs) of the loudest frame, voiced where Praat finds pitch; capped at 0.2 s."""
    import parselmouth
    from audio_utils import frame_rms
    x = audio(vid, "vocals")
    a0, b0 = max(0.0, t0 - 0.02), t1 + 0.02
    seg = x[int(a0 * SR):int(b0 * SR)].astype(np.float64)
    r = 20 * np.log10(frame_rms(seg, SR, hop))
    m = r >= r.max() - (15 if diph else 8)
    try:
        pit = parselmouth.Sound(seg, SR).to_pitch(time_step=hop, pitch_floor=60, pitch_ceiling=600)
        f = pit.selected_array["frequency"]
        vo = np.interp((np.arange(len(r)) + 0.5) * hop, pit.xs(), (f > 0).astype(float)) > 0.5
        if (m & vo).sum() >= 6:
            m &= vo
    except Exception:
        pass
    best, cur = (0, 0), 0
    for i, v in enumerate(m):
        cur = cur + 1 if v else 0
        if cur > best[1] - best[0]:
            best = (i - cur + 1, i + 1)
    s, e = best
    cap = int(0.2 / hop)
    if e - s > cap:
        c = s + int(np.argmax(r[s:e]))
        s = max(s, min(c - cap // 2, e - cap))
        e = s + cap
    return a0 + s * hop, a0 + e * hop


def formants(y, sr=SR):
    """Median F1, F2 (Hz) over the middle 60 % of a clip (Praat Burg, male settings)."""
    import parselmouth
    try:
        f = parselmouth.Sound(y.astype(np.float64), sr).to_formant_burg(
            time_step=0.005, max_number_of_formants=5, maximum_formant=5000, window_length=0.025)
    except Exception:
        return None, None
    ts = f.xs()
    if len(ts) == 0:
        return None, None
    lo, hi = ts[0] + 0.2 * (ts[-1] - ts[0]), ts[0] + 0.8 * (ts[-1] - ts[0])
    v = [(f.get_value_at_time(1, t), f.get_value_at_time(2, t)) for t in ts if lo <= t <= hi]
    v = np.array([(a, b) for a, b in v if np.isfinite(a) and np.isfinite(b)])
    if len(v) == 0:
        return None, None
    return round(float(np.median(v[:, 0])), 1), round(float(np.median(v[:, 1])), 1)


def collect_candidates(data):
    """Yield (category, key, dict) raw candidates from alignment data."""
    ph_c, syl_c, word_c, mut_c = defaultdict(list), [], [], []
    for r in data:
        vid, ph, words = r["vid"], r["phones"], r["words"]
        spk = r["spk_conf"]
        # --- single phones
        for i, p in enumerate(ph):
            if len(p["arpa"]) != 1:
                continue
            a = p["arpa"][0]
            if a not in VOWELS and a not in CONS_KEEP:
                continue
            ph_c[a].append({"vid": vid, "t0": p["t0"], "t1": p["t1"], "post": p["post"], "spk": spk})
        # --- syllables (within one word, C V or C V C)
        byword = defaultdict(list)
        for p in ph:
            if p["word"] is not None and p["arpa"]:
                byword[p["word"]].append(p)
        for wi, ps in byword.items():
            seq = [(a, p) for p in ps for a in p["arpa"]]
            # expand multi-phone tokens: they share the same time span; skip those for syllables
            if any(len(p["arpa"]) != 1 for p in ps):
                continue
            arp = [p["arpa"][0] for p in ps]
            for k, a in enumerate(arp):
                if a not in VOWELS or k == 0 or arp[k - 1] in VOWELS or arp[k - 1] == "DX":
                    continue
                c0 = ps[k - 1]
                # CV (vowel must end the word or be followed by a consonant)
                if k + 1 == len(arp) or arp[k + 1] not in VOWELS:
                    syl_c.append({"vid": vid, "t0": c0["t0"], "t1": ps[k]["t1"], "phones": [arp[k - 1], a],
                                  "post": (c0["post"] + ps[k]["post"]) / 2, "spk": spk,
                                  "edge": k - 1 == 0})
                # CVC (coda consonant at word end or before another consonant)
                if k + 1 < len(arp) and arp[k + 1] not in VOWELS and arp[k + 1] != "DX" and \
                        (k + 2 == len(arp) or arp[k + 2] not in VOWELS):
                    c1 = ps[k + 1]
                    syl_c.append({"vid": vid, "t0": c0["t0"], "t1": c1["t1"],
                                  "phones": [arp[k - 1], a, arp[k + 1]],
                                  "post": (c0["post"] + ps[k]["post"] + c1["post"]) / 3, "spk": spk,
                                  "edge": k - 1 == 0 and k + 2 == len(arp)})
        # --- words + interjection mutters + stammers
        for wi, w in enumerate(words):
            txt = norm_word(w["w"])
            ps = byword.get(wi, [])
            if not txt or not ps:
                continue
            t0, t1 = min(p["t0"] for p in ps), max(p["t1"] for p in ps)
            arp = [a for p in ps for a in p["arpa"]]
            prev_gap = w["t0"] - words[wi - 1]["t1"] if wi > 0 else 1.0
            next_gap = words[wi + 1]["t0"] - w["t1"] if wi + 1 < len(words) else 1.0
            iso = min(1.0, max(prev_gap, 0) / 0.15) * 0.5 + min(1.0, max(next_gap, 0) / 0.15) * 0.5
            if txt in INTERJ:
                mut_c.append({"vid": vid, "t0": t0, "t1": t1, "kind": INTERJ[txt], "text": txt,
                              "post": w["p"], "spk": spk, "phones": arp})
                continue
            if w["p"] >= 0.7 and 0.12 <= t1 - t0 <= 0.9 and any(a in VOWELS for a in arp):
                word_c.append({"vid": vid, "t0": t0, "t1": t1, "text": txt, "post": w["p"], "spk": spk,
                               "iso": iso, "phones": arp})
            # stammer: word onset consonant + first half of the vowel ("b-", "t-")
            if len(ps) >= 2 and len(ps[0]["arpa"]) == 1 and len(ps[1]["arpa"]) == 1 and \
                    ps[0]["arpa"][0] in CONS_KEEP and ps[1]["arpa"][0] in VOWELS and prev_gap > 0.04:
                v = ps[1]
                te = v["t0"] + 0.5 * (v["t1"] - v["t0"])
                if 0.07 <= te - ps[0]["t0"] <= 0.2:
                    mut_c.append({"vid": vid, "t0": ps[0]["t0"], "t1": te, "kind": "stammer",
                                  "text": romanize([ps[0]["arpa"][0]]) + "-", "post": min(ps[0]["post"], v["post"]),
                                  "spk": spk, "phones": [ps[0]["arpa"][0], v["arpa"][0]]})
        # --- non-lexical fillers: phone runs outside any whisper word
        run = []
        for p in ph + [None]:
            if p is not None and p["word"] is None and p["arpa"]:
                if run and p["t0"] - run[-1]["t1"] > 0.12:
                    _flush_filler(run, vid, spk, words, mut_c)
                    run = []
                run.append(p)
            else:
                if run:
                    _flush_filler(run, vid, spk, words, mut_c)
                run = []
    return ph_c, syl_c, word_c, mut_c


def _flush_filler(run, vid, spk, words, mut_c):
    t0, t1 = run[0]["t0"], run[-1]["t1"]
    arp = [a for p in run for a in p["arpa"]]
    if not (0.12 <= t1 - t0 <= 0.8) or len(arp) > 4:
        return
    if any(min(t1, w["t1"]) - max(t0, w["t0"]) > 0.02 for w in words):
        return
    if not any(a in VOWELS or a in ("M", "N") for a in arp):
        return
    kind = "hmm" if all(a in ("M", "N", "HH", "AH") for a in arp) and "M" in arp else \
        "er" if "ER" in arp else "uh"
    mut_c.append({"vid": vid, "t0": t0, "t1": t1, "kind": kind, "text": romanize(arp),
                  "post": float(np.mean([p["post"] for p in run])), "spk": spk, "phones": arp})


def ast_mutters(data, tags, diar):
    """Laughs / grunts found by AST on the vocals stem near Leno speech, away from other voices."""
    others = [(c["vid"], c["t0"], c["t1"]) for c in diar if c["sim_leno"] < 0.35 and c["dur"] >= 0.6]
    words_by_vid = defaultdict(list)
    for r in data:
        words_by_vid[r["vid"]] += r["words"]
    out = []
    groups = {"laugh": (["Laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle"], 0.12),
              "grunt": (["Grunt", "Groan"], 0.25)}
    for vid in IDS:
        t, P = tags.get(vid, "vocals")
        for kind, (names, thr) in groups.items():
            s = sum(P[:, tags.idx[n]] for n in names)
            for i in np.argsort(-s):
                if s[i] < thr:
                    break
                c0, c1 = t[i], t[i] + 1.0
                if any(v == vid and min(c1, b) - max(c0, a) > 0 for v, a, b in others):
                    continue
                near = any(r["vid"] == vid and r["t0"] - 1.5 <= c0 <= r["t1"] + 1.5 for r in data)
                if not near:
                    continue
                if any(o["vid"] == vid and abs(o["t0"] - c0) < 1.0 for o in out):
                    continue
                speechy = sum(min(c1, w["t1"]) - max(c0, w["t0"]) for w in words_by_vid[vid]
                              if min(c1, w["t1"]) > max(c0, w["t0"]))
                out.append({"vid": vid, "t0": float(c0), "t1": float(c1), "kind": kind, "text": kind,
                            "post": float(min(1.0, s[i] * 2)), "spk": 0.5, "phones": [],
                            "ast": float(s[i]), "speech_overlap": float(speechy)})
    return out


def main():
    data = jload(SRC / "align" / "phones.json")
    diar = jload(SRC / "diar" / "chunks.json")["chunks"]
    tags = Tags()
    qc = QC()
    ph_c, syl_c, word_c, mut_c = collect_candidates(data)
    mut_c += ast_mutters(data, tags, diar)
    stats = defaultdict(lambda: [0, 0])     # category -> [tested, passed recognizer]
    results = {"phonemes": defaultdict(list), "syllables": [], "mutters": [], "words": []}

    def common_checks(c, min_snr):
        c["snr"] = float(sep_snr_db(c["vid"], c["t0"], c["t1"]))
        v = tags.span(c["vid"], "vocals", c["t0"], c["t1"])
        c["music"] = tags.p(v, "Music")
        return c["snr"] >= min_snr and c["music"] < 0.45 and c["spk"] >= 0.35

    def finish(c, y, a, b, extra_conf):
        y, r = normalize(y, TARGET_RMS)
        c["y"], c["a"], c["b"], c["rms"] = y, a, b, r
        c["f0"] = median_f0(y)
        c["conf"] = round(float((c["post"] * extra_conf * c["spk"]) ** (1 / 3)), 3)
        return c

    # ---------- phonemes
    fstats = {}
    for a, cands in ph_c.items():
        isv = a in VOWELS
        want = N_VOWEL if isv else N_CONS
        mind = 0.05 if isv else 0.04
        cands = [c for c in cands if c["t1"] - c["t0"] >= mind and c["post"] >= 0.25]
        for c in cands:
            c["score"] = c["post"] * min(1.0, (c["t1"] - c["t0"]) / 0.12)
        cands.sort(key=lambda c: -c["score"])
        strong = [c for c in cands if c["post"] >= 0.45][:want * 10]
        # rare vowels: relaxed second pass (posterior >= 0.25) only if the strict pass is thin
        weak = [c for c in cands if c["post"] < 0.45][:want * 6]
        kept = []
        for c in strong + weak:
            if c["post"] < 0.45 and len(kept) >= 3:
                break
            if len(kept) >= want * (3 if a in MONO else 1):
                break
            if not common_checks(c, 3.0 if isv else 0.0):
                continue
            if isv:
                t0, t1 = vowel_nucleus(c["vid"], c["t0"], c["t1"], diph=a in DIPH)
                if t1 - t0 < mind:
                    continue
                y, ta, tb = make_clip(c["vid"], t0, t1, trim=False)
            else:
                y, ta, tb = make_clip(c["vid"], c["t0"], c["t1"])
            if tb - ta < mind * 0.8:
                continue
            key = "ph_" + ("V" if isv else "C")
            stats[key][0] += 1
            if not qc.ctx_check(c["vid"], ta, tb, [a], tol=0.06 if isv else 0.02):
                continue
            stats[key][1] += 1
            seq, P = qc.phones(y)
            c["iso_seq"] = seq
            c["iso_top"] = qc.vowel_rank(P)[:2] if isv else None
            stats[key + "_iso"][0] += 1
            stats[key + "_iso"][1] += int(a in seq)
            if a in MONO:
                c["F1"], c["F2"] = formants(y)
            kept.append(finish(c, y, ta, tb, max(qc.target_post(P, a), c["post"] * 0.5)))
        results["phonemes"][a] = kept
    # formant sanity check on monophthongs: drop within-class outliers (log F1/F2, robust z > 2.5)
    for a in MONO:
        ks = [c for c in results["phonemes"].get(a, []) if c.get("F1") and c.get("F2")]
        if len(ks) >= 4:
            X = np.log([[c["F1"], c["F2"]] for c in ks])
            med = np.median(X, 0)
            mad = np.median(np.abs(X - med), 0) * 1.4826 + 0.03
            for c, xx in zip(ks, X):
                c["fz"] = float(np.max(np.abs((xx - med) / mad)))
            fstats[a] = [float(v) for v in np.exp(med)]
        results["phonemes"][a] = sorted([c for c in results["phonemes"].get(a, [])
                                         if c.get("F1") and c.get("F2") and c.get("fz", 0) <= 2.5],
                                        key=lambda c: -c["conf"])[:N_VOWEL]
    # leave-one-out nearest-centroid agreement in (logF1, logF2) against Leno's own vowel medians
    agree = [0, 0]
    for a in MONO:
        for c in results["phonemes"][a]:
            others = {}
            for b in MONO:
                pts = [d for d in results["phonemes"][b] if d is not c]
                if len(pts) >= 2:
                    others[b] = np.median(np.log([[d["F1"], d["F2"]] for d in pts]), 0)
            x = np.log([c["F1"], c["F2"]])
            near = sorted(others, key=lambda b: float(np.sum((x - others[b]) ** 2)))
            c["formant_near"] = near[:2]
            agree[0] += 1
            agree[1] += int(a in near[:2])
    stats["formant_top2"] = agree
    print("Leno vowel formant medians (F1,F2 Hz):", {k: [round(v) for v in f] for k, f in fstats.items()})

    # ---------- syllables
    for c in syl_c:
        c["score"] = c["post"] * (1.15 if c["edge"] else 1.0) * min(1.0, (c["t1"] - c["t0"]) / 0.18)
    syl_c.sort(key=lambda c: -c["score"])
    seen = defaultdict(int)
    for c in syl_c:
        if len(results["syllables"]) >= N_SYL:
            break
        key = " ".join(c["phones"])
        if seen[key] >= 2 or c["post"] < 0.45 or not (0.1 <= c["t1"] - c["t0"] <= 0.45):
            continue
        if not common_checks(c, 3.0):
            continue
        y, ta, tb = make_clip(c["vid"], c["t0"], c["t1"])
        stats["syllables"][0] += 1
        if not qc.ctx_check(c["vid"], ta, tb, c["phones"], seq_mode=True):
            continue
        seq, P = qc.phones(y)
        # isolated re-recognition: consonants must be heard; vowel may be any vowel (isolation bias)
        wild = ["V" if p in VOWELS else p for p in seq]
        tgt = ["V" if p in VOWELS else p for p in c["phones"]]
        if edit(wild, tgt) > 1:
            continue
        stats["syllables"][1] += 1
        stats["syllables_iso_exact"][0] += 1
        stats["syllables_iso_exact"][1] += int(edit(seq, c["phones"]) == 0)
        tp = float(np.mean([qc.target_post(P, p) for p in c["phones"]]))
        c["text"] = romanize(c["phones"])
        seen[key] += 1
        results["syllables"].append(finish(c, y, ta, tb, max(tp, c["post"] * 0.5)))

    # ---------- words (Whisper re-transcription of the clip must match)
    from faster_whisper import WhisperModel
    wm = WhisperModel("large-v3", device="cuda", compute_type="float16")
    import librosa
    for c in word_c:
        c["score"] = c["post"] * (0.6 + 0.4 * c["iso"])
    word_c.sort(key=lambda c: -c["score"])
    seen = defaultdict(int)
    for c in word_c:
        if len(results["words"]) >= N_WORD:
            break
        if seen[c["text"]] >= 2 or not common_checks(c, 3.0):
            continue
        y, ta, tb = make_clip(c["vid"], c["t0"] - 0.02, c["t1"] + 0.03)
        y16 = librosa.resample(y, orig_sr=SR, target_sr=16000)
        pad = np.zeros(int(0.3 * 16000), np.float32)
        segs, _ = wm.transcribe(np.concatenate([pad, y16, pad]), language="en", beam_size=5,
                                condition_on_previous_text=False, without_timestamps=True)
        heard = " ".join(norm_word(w) for s in segs for w in s.text.split())
        stats["words"][0] += 1
        if c["text"] not in heard.split():
            continue
        stats["words"][1] += 1
        c["heard"] = heard
        seen[c["text"]] += 1
        results["words"].append(finish(c, y, ta, tb, 1.0))

    # ---------- mutters
    for c in mut_c:
        c["score"] = c["post"] * (1.2 if c["kind"] in ("laugh", "hmm", "er") else 1.0)
    mut_c.sort(key=lambda c: -c["score"])
    per_kind = defaultdict(int)
    caps = {"uh": 14, "hmm": 8, "er": 8, "laugh": 8, "stammer": 14, "grunt": 8}
    taken = []
    for c in mut_c:
        k = c["kind"]
        if per_kind[k] >= caps[k] or any(t["vid"] == c["vid"] and min(t["t1"], c["t1"]) > max(t["t0"], c["t0"])
                                        for t in taken):
            continue
        if not common_checks(c, 3.0 if k in ("stammer", "uh", "er", "hmm") else 0.0):
            continue
        y, ta, tb = make_clip(c["vid"], c["t0"], c["t1"], rel_db=-30)
        if tb - ta < 0.06:
            continue
        stats["mut_" + k][0] += 1
        if k in ("laugh", "grunt"):
            # AST on the cut clip must still see the event, and it must not be dominated by speech
            ok = c["ast"] >= (0.12 if k == "laugh" else 0.25)
            if not ok:
                continue
            tp = min(1.0, c["ast"] * 2)
        else:
            seq, P = qc.phones(y)
            if k == "stammer":
                ok = c["phones"][0] in seq
                tp = qc.target_post(P, c["phones"][0])
            else:
                ok = any(a in VOWELS or a in ("M", "N") for a in seq)
                tp = max([qc.target_post(P, a) for a in c["phones"] if a in VOWELS or a in ("M", "N")] or [0.0])
            if not ok:
                continue
        stats["mut_" + k][1] += 1
        per_kind[k] += 1
        taken.append(c)
        results["mutters"].append(finish(c, y, ta, tb, tp))

    # ---------- speaker check on every unit (clip + context); drop outliers
    allu = [(cat, c) for cat in ("syllables", "mutters", "words") for c in results[cat]] + \
           [("phonemes", c) for a in results["phonemes"] for c in results["phonemes"][a]]
    for cat, c in allu:
        c["clip_sim"] = qc.spk.sim(c["y"]) if len(c["y"]) >= int(0.1 * SR) else None
        c["ctx_sim"] = context_sim(qc, c["vid"], c["a"], c["b"])
    ctx = np.array([c["ctx_sim"] for _, c in allu])
    thr = max(0.35, float(np.mean(ctx) - 2.5 * np.std(ctx)))
    dropped = 0

    def ok(c):
        if c["ctx_sim"] < thr:
            return False
        if c["clip_sim"] is not None and len(c["y"]) >= int(0.4 * SR) and c["clip_sim"] < 0.25:
            return False
        return True
    for a in list(results["phonemes"]):
        n0 = len(results["phonemes"][a]); results["phonemes"][a] = [c for c in results["phonemes"][a] if ok(c)]
        dropped += n0 - len(results["phonemes"][a])
    for cat in ("syllables", "mutters", "words"):
        n0 = len(results[cat]); results[cat] = [c for c in results[cat] if ok(c)]
        dropped += n0 - len(results[cat])
    print("speaker ctx threshold %.3f, dropped %d" % (thr, dropped))

    # ---------- write
    import shutil
    for sub in ("phonemes", "syllables", "mutters", "words"):
        d = OUT / "leno" / sub
        if d.exists():
            shutil.rmtree(d)
    manifest = {"phonemes": {}, "syllables": [], "mutters": [], "words": []}

    def clip_entry(c, rel):
        encode_ogg(c["y"], OUT / rel)
        return {"file": rel, "dur": round(len(c["y"]) / SR, 3), "rms": round(c["rms"], 4), "f0": c["f0"],
                "src": {"video": c["vid"], "t0": round(c["a"], 3), "t1": round(c["b"], 3)},
                "conf": c["conf"],
                "_qc": {"snr_db": round(c["snr"], 1), "music": round(c["music"], 3),
                        "clip_sim": None if c["clip_sim"] is None else round(c["clip_sim"], 3),
                        "ctx_sim": round(c["ctx_sim"], 3),
                        **({"F1": c["F1"], "F2": c["F2"], "formant_near": c.get("formant_near")} if c.get("F1") else {}),
                        **({"iso_seq": c["iso_seq"]} if "iso_seq" in c else {}),
                        **({"heard": c["heard"]} if "heard" in c else {})}}
    for a in VOWELS + CONS_KEEP:
        cs = sorted(results["phonemes"].get(a, []), key=lambda c: -c["conf"])
        if cs:
            manifest["phonemes"][a] = [clip_entry(c, f"leno/phonemes/{a}_{i:03d}.ogg") for i, c in enumerate(cs, 1)]
    for i, c in enumerate(sorted(results["syllables"], key=lambda c: (c["text"], -c["conf"])), 1):
        e = clip_entry(c, f"leno/syllables/{c['text']}_{i:03d}.ogg"); e.update(text=c["text"], phones=c["phones"])
        manifest["syllables"].append(e)
    for i, c in enumerate(sorted(results["mutters"], key=lambda c: (c["kind"], -c["conf"])), 1):
        e = clip_entry(c, f"leno/mutters/{c['kind']}_{i:03d}.ogg"); e.update(kind=c["kind"])
        manifest["mutters"].append(e)
    for i, c in enumerate(sorted(results["words"], key=lambda c: (c["text"], -c["conf"])), 1):
        e = clip_entry(c, f"leno/words/{re.sub('[^a-z]', '', c['text'])}_{i:03d}.ogg"); e.update(text=c["text"])
        manifest["words"].append(e)
    jdump({"leno": manifest, "stats": {k: v for k, v in stats.items()}, "speaker_ctx_threshold": thr},
          SRC / "units" / "leno_units.json")
    for k, v in sorted(stats.items()):
        print("%-12s tested %3d  passed re-recognition %3d" % (k, v[0], v[1]))
    print({a: len(v) for a, v in manifest["phonemes"].items()})
    print("syllables", len(manifest["syllables"]), "mutters", len(manifest["mutters"]), "words", len(manifest["words"]))


if __name__ == "__main__":
    main()
