"""
Extra sound effects that don't exist in the two Grey Leno videos (no clean booing, cheering or
vomiting there; the tagger's "retch" hits were burps). Sources are short YouTube sound-effect uploads.

    python tools/audio/s09_extra_sfx.py        (system Python + yt-dlp + ffmpeg)

- downloads each source's audio to assets/_src/audio/extra/
- cuts: 'event' sources are split on silences; 'bed' sources (continuous crowd) into 2.5-4 s chunks
- trims, fades, loudness-normalises to -18 LUFS, mono 48 kHz Opus
- writes clips to assets/audio/<group>/<kind>/ and merges them into assets/audio/manifest.json
- the old sfx/retch clips (really burps, per the AudioSet tagger) are moved to sfx/burp
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "_src", "audio", "extra")
OUT = os.path.join(ROOT, "assets", "audio")
FFMPEG = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"
PY = sys.executable

SOURCES = [
    # group, kind, video id, mode, max clips
    ("crowd", "boo", "u0D718AmYTs", "bed", 3),
    ("crowd", "boo", "hJlxgWYqvR0", "bed", 3),
    ("crowd", "boo", "Dk3OZ4a9m6o", "bed", 3),
    ("crowd", "cheer", "barWV7RWkq0", "bed", 3),
    ("crowd", "cheer", "Vw9MCNbFggI", "bed", 3),
    ("crowd", "cheer", "JhE6hEgTth0", "bed", 2),
    ("sfx", "vomit", "UnDhyWnHPD0", "event", 3),
    ("sfx", "vomit", "RgJ8wfuDfo4", "event", 3),
    ("sfx", "vomit", "yoD5T0N1SzU", "event", 3),
    ("sfx", "retch", "pf93OHsjkQM", "event", 3),
    ("sfx", "retch", "A3wzIw1tWkw", "event", 3),
    ("sfx", "retch", "jqHViajqnwc", "event", 3),
]


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="ignore")


def download(vid):
    wav = os.path.join(SRC, vid + ".wav")
    if not os.path.exists(wav):
        run([PY, "-m", "yt_dlp", "-q", "-x", "--audio-format", "wav", "-o", os.path.join(SRC, vid + ".%(ext)s"),
             f"https://www.youtube.com/watch?v={vid}"])
    return wav if os.path.exists(wav) else None


def duration(path):
    r = run([FFMPEG, "-i", path])
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0


def sounding_spans(path, noise_db=-38, min_sil=0.25):
    """non-silent spans [(t0, t1)] via ffmpeg silencedetect"""
    r = run([FFMPEG, "-i", path, "-af", f"silencedetect=noise={noise_db}dB:d={min_sil}", "-f", "null", "-"])
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    total = duration(path)
    spans, t = [], 0.0
    for s, e in zip(starts, ends + [total]):
        if s - t > 0.2:
            spans.append((t, s))
        t = e
    if total - t > 0.2:
        spans.append((t, total))
    return spans


def cut(src, t0, t1, dst):
    d = t1 - t0
    fade = min(0.05, d / 4)
    af = f"afade=t=in:d={fade},afade=t=out:st={max(0, d - fade * 3)}:d={fade * 3},loudnorm=I=-18:TP=-2:LRA=11"
    r = run([FFMPEG, "-y", "-ss", f"{t0:.3f}", "-t", f"{d:.3f}", "-i", src, "-ac", "1", "-ar", "48000", "-af", af,
             "-c:a", "libopus", "-b:a", "64k", dst])
    return r.returncode == 0


def main():
    os.makedirs(SRC, exist_ok=True)
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    # the agent's retch clips are burps: move them
    old = man["sfx"].pop("retch", [])
    if old and not man["sfx"].get("burp"):
        os.makedirs(os.path.join(OUT, "sfx", "burp"), exist_ok=True)
        for c in old:
            new = c["file"].replace("sfx/retch/retch_", "sfx/burp/burp_")
            if os.path.exists(os.path.join(OUT, c["file"])):
                shutil.move(os.path.join(OUT, c["file"]), os.path.join(OUT, new))
            c["file"] = new
        man["sfx"]["burp"] = old
    counters = {}
    for group, kind, vid, mode, maxn in SOURCES:
        wav = download(vid)
        if not wav:
            print("  ! download failed", vid); continue
        spans = sounding_spans(wav)
        clips = []
        if mode == "event":
            spans = [s for s in spans if 0.35 <= s[1] - s[0] <= 4.0] or [(s[0], min(s[1], s[0] + 3.5)) for s in spans[:1]]
            clips = sorted(spans, key=lambda s: -(s[1] - s[0]))[:maxn]
        else:
            for s0, s1 in spans:
                t = s0 + 0.3
                while t + 2.5 <= s1 and len(clips) < maxn:
                    L = min(4.0, s1 - t)
                    clips.append((t, t + L)); t += L + 0.5
        folder = os.path.join(OUT, group, kind)
        os.makedirs(folder, exist_ok=True)
        man.setdefault(group, {}).setdefault(kind, [])
        man[group][kind] = [c for c in man[group][kind] if c.get("src", {}).get("video") != vid]   # re-runnable
        for t0, t1 in sorted(clips):
            n = counters[(group, kind)] = counters.get((group, kind), 0) + 1
            rel = f"{group}/{kind}/{kind}_x{n:03d}.ogg"
            if cut(wav, t0, t1, os.path.join(OUT, rel)):
                man[group][kind].append({"file": rel.replace("\\", "/"), "dur": round(t1 - t0, 3), "rms": None, "f0": None,
                                         "src": {"video": vid, "t0": round(t0, 3), "t1": round(t1, 3)}, "conf": None,
                                         "origin": "youtube-sfx"})
        print(f"{group}/{kind} {vid}: {len(clips)} clips")
    srcs = {s["id"] for s in man.get("sources", [])}
    for _, _, vid, _, _ in SOURCES:
        if vid not in srcs:
            man["sources"].append({"id": vid, "url": f"https://www.youtube.com/watch?v={vid}", "title": "sound effect"})
    json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)
    print({g: {k: len(v) for k, v in man[g].items()} for g in ("sfx", "crowd")})


if __name__ == "__main__":
    main()
