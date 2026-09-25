"""
Stock percussion for the show (the monologue's rimshots and drum rolls), from freely licensed recordings:
  - "Ba dum tss [Joke Rimshot]" by FREE_SOUND_ENTERTAINMENT on Freesound, CC BY 3.0 (credit required)
  - "Drum Roll Intro.ogg" on Wikimedia Commons, CC0
  - "Drum Roll - Concert Band - United States Air Force Band.mp3" on Wikimedia Commons, public domain (US government)

    python tools/audio/s10_stock_sfx.py        (system Python + ffmpeg)

- downloads each source to assets/_src/audio/stock/
- cuts, fades, loudness-normalises to -18 LUFS, mono 48 kHz Opus (like s09_extra_sfx.py)
- writes clips to assets/audio/sfx/{rimshot,drumroll}/ and merges them into assets/audio/manifest.json, with each
  source's licence and author in `sources`
"""
import json
import os
import shutil
import subprocess
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "_src", "audio", "stock")
OUT = os.path.join(ROOT, "assets", "audio")
FFMPEG = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"
UA = "FlyLeno/1.0 (https://flyleno.viosarcade.xyz)"

FS = "https://freesound.org/people/FREE_SOUND_ENTERTAINMENT/sounds/"
SOURCES = [
    # kind, id, download url, page, title, licence, author, cuts [(t0, t1)] in s
    ("rimshot", "freesound-561869", "https://cdn.freesound.org/previews/561/561869_12614915-hq.mp3", FS + "561869/",
     "Ba dum tss [Joke Rimshot] - Unmixed", "CC BY 3.0", "FREE_SOUND_ENTERTAINMENT", [(0.08, 2.6)]),
    ("rimshot", "freesound-561862", "https://cdn.freesound.org/previews/561/561862_12614915-hq.mp3", FS + "561862/",
     "Ba dum tss [Joke Rimshot] - Blue Ridge", "CC BY 3.0", "FREE_SOUND_ENTERTAINMENT", [(0.08, 2.6)]),
    ("rimshot", "freesound-561959", "https://cdn.freesound.org/previews/561/561959_12614915-hq.mp3", FS + "561959/",
     "Ba dum tss [Joke Rimshot] - Boutique SP12", "CC BY 3.0", "FREE_SOUND_ENTERTAINMENT", [(0.08, 1.9)]),
    ("rimshot", "freesound-561969", "https://cdn.freesound.org/previews/561/561969_12614915-hq.mp3", FS + "561969/",
     "Ba dum tss [Joke Rimshot] - Modern Club", "CC BY 3.0", "FREE_SOUND_ENTERTAINMENT", [(0.08, 1.9)]),
    ("drumroll", "commons-drum-roll-intro", "https://upload.wikimedia.org/wikipedia/commons/c/c4/Drum_Roll_Intro.ogg",
     "https://commons.wikimedia.org/wiki/File:Drum_Roll_Intro.ogg", "Drum Roll Intro", "CC0", "Iwan Sounds and DIY", [(0.0, 3.75)]),
    ("drumroll", "commons-usaf-drum-roll",
     "https://upload.wikimedia.org/wikipedia/commons/0/05/Drum_Roll_-_Concert_Band_-_United_States_Air_Force_Band.mp3",
     "https://commons.wikimedia.org/wiki/File:Drum_Roll_-_Concert_Band_-_United_States_Air_Force_Band.mp3",
     "Drum Roll - Concert Band - United States Air Force Band", "Public domain", "United States Air Force Band", [(1.5, 31.5)]),
]


def download(url, name):
    path = os.path.join(SRC, name)
    if not os.path.exists(path):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req) as r, open(path, "wb") as f:
            f.write(r.read())
    return path


def cut(src, t0, t1, dst):
    d = t1 - t0
    fade = min(0.05, d / 4)
    af = f"afade=t=in:d=0.005,afade=t=out:st={max(0, d - fade * 4)}:d={fade * 4},loudnorm=I=-18:TP=-2:LRA=11"
    r = subprocess.run([FFMPEG, "-y", "-ss", f"{t0:.3f}", "-t", f"{d:.3f}", "-i", src, "-ac", "1", "-ar", "48000", "-af", af,
                        "-c:a", "libopus", "-b:a", "64k", dst], capture_output=True, text=True)
    return r.returncode == 0


def main():
    os.makedirs(SRC, exist_ok=True)
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    counters = {}
    ids = {sid for _, sid, *_ in SOURCES}
    for kind in {k for k, *_ in SOURCES}:
        man["sfx"][kind] = [c for c in man["sfx"].get(kind, []) if c.get("src", {}).get("video") not in ids]   # re-runnable
    for kind, sid, url, page, title, lic, author, cuts in SOURCES:
        src = download(url, sid + os.path.splitext(url)[1])
        folder = os.path.join(OUT, "sfx", kind)
        os.makedirs(folder, exist_ok=True)
        for t0, t1 in cuts:
            n = counters[kind] = counters.get(kind, 0) + 1
            rel = f"sfx/{kind}/{kind}_s{n:03d}.ogg"
            if cut(src, t0, t1, os.path.join(OUT, rel)):
                man["sfx"][kind].append({"file": rel, "dur": round(t1 - t0, 3), "rms": None, "f0": None,
                                         "src": {"video": sid, "t0": t0, "t1": t1}, "conf": None, "origin": "stock"})
        print(kind, sid, len(cuts), "clip(s)")
    man["sources"] = [s for s in man.get("sources", []) if s["id"] not in ids]
    for _, sid, url, page, title, lic, author, _ in SOURCES:
        man["sources"].append({"id": sid, "url": page, "title": title, "license": lic, "author": author})
    json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
