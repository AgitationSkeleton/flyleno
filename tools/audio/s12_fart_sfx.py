"""
Leno's farts: two meme sound files, `fartreverb.mp3` (the "fart with reverb" meme) and `brainfart.mp3`, copied
from a local folder of downloaded game-server sounds.

    python tools/audio/s12_fart_sfx.py [folder holding fartreverb.mp3 and brainfart.mp3]

- converts both to mono 48 kHz Opus in assets/audio/sfx/fart/ at their own level (no loudness normalisation) and
  makes them the whole `fart` pool in assets/audio/manifest.json
"""
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio")
FFMPEG = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"
DEFAULT = r"C:\Program Files (x86)\Steam\steamapps\sourcemods\open_fortress\download\sound\dagobah"
SID = "fart-memes"
FILES = ["fartreverb.mp3", "brainfart.mp3"]


def duration(path):
    r = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    os.makedirs(os.path.join(OUT, "sfx", "fart"), exist_ok=True)
    clips = []
    for f in FILES:
        rel = f"sfx/fart/{os.path.splitext(f)[0]}.ogg"
        r = subprocess.run([FFMPEG, "-y", "-i", os.path.join(src, f), "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "96k",
                            os.path.join(OUT, rel)], capture_output=True, text=True)
        if r.returncode == 0:
            d = round(duration(os.path.join(src, f)), 3)
            clips.append({"file": rel, "dur": d, "rms": None, "f0": None, "src": {"video": SID, "file": f, "t0": 0, "t1": d},
                          "conf": None, "origin": "meme"})
    man["sfx"]["fart"] = clips
    print("fart", len(clips), "clips")
    man["sources"] = [s for s in man.get("sources", []) if s["id"] != SID]
    man["sources"].append({"id": SID, "url": "", "title": "fartreverb.mp3 and brainfart.mp3 (meme sounds)", "author": "unknown"})
    json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
