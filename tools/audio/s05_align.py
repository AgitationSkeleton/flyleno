"""Step 5: phoneme recognition + timing over Leno-only regions.

wav2vec2 CTC phoneme model (facebook/wav2vec2-lv-60-espeak-cv-ft) on the vocals stem,
decoding restricted to the en-us espeak phone inventory (phonemap.EN_TOKENS).
CTC emissions are spiky, so each boundary between two consecutive emitted tokens is
placed where the split maximises sum(log p(tok_i)) left + sum(log p(tok_i+1)) right.
Tokens separated by a long blank stretch get a bounded extension (then energy-trimmed
at export). Whisper words are attached to phones by time overlap.
Output: _src/audio/align/phones.json"""
import json
import numpy as np
import torch
from transformers import AutoModelForCTC, Wav2Vec2FeatureExtractor
from huggingface_hub import hf_hub_download
from common import SRC, IDS, stem, load, jdump, jload
from phonemap import to_arpa

MODEL = "facebook/wav2vec2-lv-60-espeak-cv-ft"
FR = 0.02            # CTC frame hop (s)
MAXGAP = 4           # frames; longer blank gaps = token boundary is a pause
EXT = {"V": 0.10, "C": 0.06}   # bounded extension into long gaps (s)


class Recognizer:
    def __init__(self):
        v = json.load(open(hf_hub_download(MODEL, "vocab.json"), encoding="utf8"))
        self.inv = {i: k for k, i in v.items()}
        self.blank = v["<pad>"]
        self.fe = Wav2Vec2FeatureExtractor.from_pretrained(MODEL)
        self.m = AutoModelForCTC.from_pretrained(MODEL).cuda().eval()
        from phonemap import EN_TOKENS
        mask = torch.full((len(v),), float("-inf"))
        for tok, i in v.items():
            if tok in EN_TOKENS or i == self.blank:
                mask[i] = 0.0
        self.mask = mask.cuda()

    def logprobs(self, x):
        iv = self.fe(x, sampling_rate=16000, return_tensors="pt").input_values.cuda()
        with torch.no_grad():
            lg = self.m(iv).logits[0].float() + self.mask   # English phone inventory only
            return lg.log_softmax(-1).cpu().numpy()

    def tokens(self, lp):
        """Greedy CTC runs -> list of (token, frame_a, frame_b, mean_post)."""
        am = lp.argmax(-1)
        out, i = [], 0
        while i < len(am):
            j = i
            while j + 1 < len(am) and am[j + 1] == am[i]:
                j += 1
            if am[i] != self.blank:
                out.append([self.inv[int(am[i])], i, j + 1, int(am[i]),
                            float(np.exp(lp[i:j + 1, am[i]]).mean())])
            i = j + 1
        return out

    def segment(self, lp, t0=0.0):
        """Emitted tokens with start/end times (s)."""
        toks = self.tokens(lp)
        res = []
        for k, (tok, a, b, tid, post) in enumerate(toks):
            res.append({"ipa": tok, "tid": tid, "pa": a, "pb": b, "post": post})
        from phonemap import IPA2ARPA, VOWELS
        for k, r in enumerate(res):
            kind = "V" if IPA2ARPA.get(r["ipa"]) in VOWELS else "C"
            ext = int(round(EXT[kind] / FR))
            # left edge
            if k > 0 and r["pa"] - res[k - 1]["pb"] <= MAXGAP:
                pass  # set by previous iteration's split
            else:
                r["a"] = max(0, r["pa"] - max(1, ext // 2))
            # right edge / split with next
            if k + 1 < len(res) and res[k + 1]["pa"] - r["pb"] <= MAXGAP:
                n = res[k + 1]
                lo, hi = r["pb"], n["pa"]
                best, cut = -1e9, lo
                for c in range(lo, hi + 1):
                    s = lp[r["pa"]:c, r["tid"]].sum() + lp[c:n["pb"], n["tid"]].sum()
                    if s > best:
                        best, cut = s, c
                r["b"] = cut; n["a"] = cut
            else:
                r["b"] = min(len(lp), r["pb"] + ext)
            r.setdefault("a", r["pa"])
        for r in res:
            r["t0"] = round(t0 + r["a"] * FR, 3); r["t1"] = round(t0 + r["b"] * FR, 3)
            r["tpk"] = round(t0 + (r["pa"] + r["pb"]) / 2 * FR, 3)   # CTC spike centre
            r["arpa"] = to_arpa(r["ipa"])
            for key in ("pa", "pb", "a", "b", "tid"):
                r.pop(key)
        return res


def regions(segs, gap=0.6, pad=0.2):
    iv = sorted((s["t0"] - pad, s["t1"] + pad, s) for s in segs)
    out = []
    for a, b, s in iv:
        if out and a - out[-1]["t1"] < gap:
            out[-1]["t1"] = max(out[-1]["t1"], b); out[-1]["segs"].append(s)
        else:
            out.append({"t0": max(0.0, a), "t1": b, "segs": [s]})
    return out


def main():
    rec = Recognizer()
    leno = jload(SRC / "diar" / "leno_segments.json")["segments"]
    out = []
    for vid in IDS:
        x, sr = load(stem(vid, "vocals"), sr=16000)
        words = [w for s in jload(SRC / "transcripts" / f"{vid}.json")["segments"] for w in s["words"]]
        for r in regions([s for s in leno if s["vid"] == vid]):
            lp = rec.logprobs(x[int(r["t0"] * sr):int(r["t1"] * sr)])
            ph = rec.segment(lp, r["t0"])
            conf = max(s["conf"] for s in r["segs"])
            rw = [w for w in words if w["t0"] >= r["t0"] - 0.05 and w["t1"] <= r["t1"] + 0.05]
            for p in ph:
                c = (p["t0"] + p["t1"]) / 2
                p["word"] = next((i for i, w in enumerate(rw) if w["t0"] - 0.03 <= c <= w["t1"] + 0.03), None)
            out.append({"vid": vid, "t0": r["t0"], "t1": r["t1"], "spk_conf": conf,
                        "sim_leno": max(s["sim_leno"] for s in r["segs"]),
                        "chunks": [[s["t0"], s["t1"], s["sim_leno"]] for s in r["segs"]],
                        "words": rw, "phones": ph})
            print(vid, "%.1f-%.1f" % (r["t0"], r["t1"]), len(ph), "phones", len(rw), "words")
    jdump(out, SRC / "align" / "phones.json")


if __name__ == "__main__":
    main()
