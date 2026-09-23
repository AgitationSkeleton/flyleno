"""Step 4: AudioSet tagging (AST, MIT/ast-finetuned-audioset-10-10-0.4593) over sliding
1.0 s windows (hop 0.25 s) of the full mix, vocals stem and non-vocal stem.
Saves sigmoid probabilities per window to _src/audio/tags/{vid}_{stem}.npz."""
import sys
import numpy as np
import torch
from transformers import ASTFeatureExtractor, ASTForAudioClassification
from common import SRC, IDS, stem, load

WIN, HOP = 1.0, 0.25
MODEL = "MIT/ast-finetuned-audioset-10-10-0.4593"

def tag_array(x, sr, fe, model, win=WIN, hop=HOP, bs=48):
    n = int(win * sr); h = int(hop * sr)
    starts = np.arange(0, max(1, len(x) - n + 1), h)
    out = []
    for i in range(0, len(starts), bs):
        batch = [x[s:s + n] for s in starts[i:i + bs]]
        feats = fe(batch, sampling_rate=sr, return_tensors="pt")["input_values"].cuda().half()
        with torch.no_grad():
            out.append(torch.sigmoid(model(feats).logits.float()).cpu().numpy().astype(np.float16))
    return starts / sr, np.concatenate(out)

def load_model():
    fe = ASTFeatureExtractor.from_pretrained(MODEL)
    model = ASTForAudioClassification.from_pretrained(MODEL).cuda().half().eval()
    return fe, model

def main():
    fe, model = load_model()
    (SRC / "tags").mkdir(parents=True, exist_ok=True)
    for vid in IDS:
        for st in ("mix", "vocals", "no_vocals"):
            p = SRC / "tags" / f"{vid}_{st}.npz"
            if p.exists() and "--force" not in sys.argv:
                continue
            x, sr = load(stem(vid, st), sr=16000)
            t, P = tag_array(x, sr, fe, model)
            np.savez_compressed(p, t=t, p=P, win=WIN)
            print(vid, st, P.shape, flush=True)

if __name__ == "__main__":
    main()
