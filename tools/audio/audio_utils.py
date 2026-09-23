"""Clip cutting, normalisation, analysis and encoding helpers."""
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
import torch

from common import FFMPEG, SRC, load, stem

SR = 44100
_cache = {}


def audio(vid, name):
    """Mono 44.1 kHz float array of a stem ('vocals','no_vocals','mix'), cached."""
    k = (vid, name)
    if k not in _cache:
        _cache[k] = load(stem(vid, name), sr=SR)[0]
    return _cache[k]


def snap_zero(x, i, win):
    """Nearest zero crossing to sample i within +-win samples."""
    a, b = max(1, i - win), min(len(x) - 1, i + win)
    seg = x[a - 1:b]
    zc = np.where(np.signbit(seg[:-1]) != np.signbit(seg[1:]))[0]
    if len(zc) == 0:
        return i
    return a - 1 + zc[np.argmin(np.abs(a - 1 + zc - i))] + 1


def cut(x, t0, t1, fade=0.012, sr=SR, snap=0.005):
    a = snap_zero(x, int(round(t0 * sr)), int(snap * sr))
    b = snap_zero(x, int(round(t1 * sr)), int(snap * sr))
    y = x[a:b].astype(np.float64).copy()
    y -= y.mean()
    n = min(int(fade * sr), len(y) // 4)
    if n > 1:
        w = 0.5 - 0.5 * np.cos(np.linspace(0, np.pi, n))
        y[:n] *= w; y[-n:] *= w[::-1]
    return y.astype(np.float32), a / sr, b / sr


def frame_rms(y, sr=SR, hop=0.005):
    h = max(1, int(hop * sr))
    n = len(y) // h
    if n == 0:
        return np.array([np.sqrt(np.mean(y ** 2) + 1e-12)])
    return np.sqrt(np.mean(y[:n * h].reshape(n, h) ** 2, 1) + 1e-12)


def energy_bounds(x, t0, t1, rel_db=-30, sr=SR, hop=0.005):
    """Shrink [t0,t1] to the part whose frame RMS is within rel_db of the max."""
    a, b = int(t0 * sr), int(t1 * sr)
    r = frame_rms(x[a:b], sr, hop)
    if len(r) < 3:
        return t0, t1
    db = 20 * np.log10(r / r.max())
    idx = np.where(db > rel_db)[0]
    return t0 + idx[0] * hop, t0 + (idx[-1] + 1) * hop


def normalize(y, target_rms=0.1, peak=0.89):
    r = float(np.sqrt(np.mean(y ** 2) + 1e-12))
    g = target_rms / r
    p = float(np.abs(y).max()) * g
    if p > peak:
        g *= peak / p
    y = (y * g).astype(np.float32)
    return y, float(np.sqrt(np.mean(y ** 2)))


def lufs_normalize(y, target=-18.0, sr=SR, peak=0.89):
    """Integrated loudness normalise (pyloudnorm) when long enough, else RMS."""
    import pyloudnorm as pyln
    if len(y) >= int(0.45 * sr):
        m = pyln.Meter(sr)
        L = m.integrated_loudness(y.astype(np.float64))
        if np.isfinite(L):
            g = 10 ** ((target - L) / 20)
            p = float(np.abs(y).max()) * g
            if p > peak:
                g *= peak / p
            y = (y * g).astype(np.float32)
            return y, float(np.sqrt(np.mean(y ** 2)))
    return normalize(y, 10 ** ((target + 1.0) / 20), peak)


def median_f0(y, sr=SR):
    import librosa
    if len(y) < int(0.05 * sr):
        y = np.pad(y, (0, int(0.05 * sr) - len(y)))
    try:
        f0, vf, _ = librosa.pyin(y.astype(np.float64), fmin=60, fmax=600, sr=sr,
                                 frame_length=2048, hop_length=256, center=True)
    except Exception:
        return None
    f0 = f0[vf & np.isfinite(f0)] if vf is not None else f0[np.isfinite(f0)]
    return round(float(np.median(f0)), 1) if len(f0) else None


def span_rms(vid, name, t0, t1):
    x = audio(vid, name)
    s = x[int(t0 * SR):int(t1 * SR)]
    return float(np.sqrt(np.mean(s ** 2) + 1e-12))


def sep_snr_db(vid, t0, t1):
    """Vocal-stem vs non-vocal-stem level over a span (dB)."""
    return 20 * np.log10(span_rms(vid, "vocals", t0, t1) / (span_rms(vid, "no_vocals", t0, t1) + 1e-9))


def encode_ogg(y, path, sr=SR, bitrate="80k"):
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
        tmp = f.name
    sf.write(tmp, y, sr, subtype="FLOAT")
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "48000",
                    "-c:a", "libopus", "-b:a", bitrate, "-application", "audio", str(path)], check=True)
    Path(tmp).unlink()


class Tags:
    """Lookup of precomputed AST window probabilities."""
    def __init__(self):
        from transformers import AutoConfig
        from s04_tag import MODEL
        self.labels = AutoConfig.from_pretrained(MODEL).id2label
        self.idx = {v: int(k) for k, v in self.labels.items()}
        self.d = {}

    def get(self, vid, st):
        if (vid, st) not in self.d:
            z = np.load(SRC / "tags" / f"{vid}_{st}.npz")
            self.d[(vid, st)] = (z["t"], z["p"].astype(np.float32))
        return self.d[(vid, st)]

    def span(self, vid, st, t0, t1):
        t, P = self.get(vid, st)
        c = t + 0.5
        m = (c >= t0 - 0.25) & (c <= t1 + 0.25)
        if not m.any():
            m = np.zeros(len(t), bool); m[np.argmin(np.abs(c - (t0 + t1) / 2))] = True
        return P[m].mean(0)

    def p(self, vec, *names):
        return float(sum(vec[self.idx[n]] for n in names))


class Speaker:
    def __init__(self):
        from speechbrain.inference.speaker import EncoderClassifier
        from speechbrain.utils.fetching import LocalStrategy
        self.enc = EncoderClassifier.from_hparams(
            "speechbrain/spkrec-ecapa-voxceleb", savedir=str(SRC / "models" / "ecapa"),
            run_opts={"device": "cuda"}, local_strategy=LocalStrategy.COPY)
        self.cen = np.load(SRC / "leno_centroid.npy")

    def emb(self, y, sr=SR):
        import librosa
        y16 = librosa.resample(np.asarray(y, np.float32), orig_sr=sr, target_sr=16000) if sr != 16000 else y
        with torch.no_grad():
            e = self.enc.encode_batch(torch.from_numpy(np.ascontiguousarray(y16))[None].cuda()).squeeze().cpu().numpy()
        return e / np.linalg.norm(e)

    def sim(self, y, sr=SR):
        return float(self.emb(y, sr) @ self.cen)
