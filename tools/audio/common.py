"""Shared paths and helpers for the Grey Leno sound-bank pipeline."""
import json
import os
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parents[2]          # flyleno/
SRC = ROOT / "assets" / "_src" / "audio"           # intermediates (git-ignored)
OUT = ROOT / "assets" / "audio"                    # final bank (git-ignored)
FFMPEG = os.environ.get("FFMPEG", "C:/ffmpeg/bin/ffmpeg")

SOURCES = [
    {"id": "w7lBVJwHABM", "title": "Vinny - Grey Leno announces his candidacy",
     "url": "https://www.youtube.com/watch?v=w7lBVJwHABM"},
    {"id": "ki3ssj466E0", "title": "[Vinesauce] Vinny - The Grey Leno Show",
     "url": "https://www.youtube.com/watch?v=ki3ssj466E0"},
]
IDS = [s["id"] for s in SOURCES]          # the two Leno videos (speech + show SFX)
# extra SFX-only sources (not used for speech work)
SFX_SOURCES = [
    {"id": "f8mL0_4GeV0", "title": "Metal pipe falling sound effect",
     "url": "https://www.youtube.com/watch?v=f8mL0_4GeV0"},
]


def load(path, sr=None, mono=True):
    """Load audio as float32; optional resample (librosa soxr)."""
    x, r = sf.read(str(path), dtype="float32", always_2d=True)
    x = x.mean(1) if mono else x.T
    if sr and r != sr:
        import librosa
        x = librosa.resample(x, orig_sr=r, target_sr=sr, res_type="soxr_hq")
        r = sr
    return x, r


def stem(vid, name):
    """Path of a separated stem: name in {'vocals','no_vocals','mix'}."""
    if name == "mix":
        return SRC / f"{vid}.wav"
    return SRC / "stems" / f"{vid}_{name}.wav"


def jdump(obj, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1,
                  default=lambda o: o.item() if hasattr(o, "item") else o.tolist())


def jload(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)) + 1e-12))
