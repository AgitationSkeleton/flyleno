"""Step 1: Demucs (htdemucs_ft) two-stem separation: vocals / no_vocals."""
import sys
import torch
import numpy as np
import soundfile as sf
from demucs.pretrained import get_model
from demucs.apply import apply_model
from common import SRC, IDS, stem, load

def main():
    dev = "cuda" if torch.cuda.is_available() else "cpu"
    model = get_model("htdemucs_ft")
    model.eval()
    (SRC / "stems").mkdir(parents=True, exist_ok=True)
    for vid in IDS:
        if stem(vid, "vocals").exists() and "--force" not in sys.argv:
            print("skip", vid); continue
        x, sr = load(stem(vid, "mix"), sr=model.samplerate, mono=False)
        wav = torch.from_numpy(x)
        ref = wav.mean(0)
        wav = (wav - ref.mean()) / (ref.std() + 1e-8)
        with torch.no_grad():
            out = apply_model(model, wav[None], device=dev, shifts=1, split=True,
                              overlap=0.25, progress=True, segment=7.8)[0]
        out = out * (ref.std() + 1e-8) + ref.mean()
        vi = model.sources.index("vocals")
        voc = out[vi]
        rest = out.sum(0) - voc
        sf.write(stem(vid, "vocals"), voc.T.numpy(), sr, subtype="FLOAT")
        sf.write(stem(vid, "no_vocals"), rest.T.numpy(), sr, subtype="FLOAT")
        # also keep individual non-vocal stems (drums/bass/other) for SFX work
        for i, n in enumerate(model.sources):
            if n != "vocals":
                sf.write(SRC / "stems" / f"{vid}_{n}.wav", out[i].T.numpy(), sr, subtype="FLOAT")
        print("done", vid)

if __name__ == "__main__":
    main()
