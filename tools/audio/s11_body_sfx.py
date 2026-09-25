"""
Body impact sounds for the ragdoll (Leno landing, tumbling, being thrown about): Half-Life 2's physics/body sounds
(Valve), copied from a local Source Filmmaker / Half-Life 2 install.

    python tools/audio/s11_body_sfx.py [path to ...\\hl2\\sound\\physics\\body]

- converts body_medium_impact_soft*, body_medium_impact_hard* and body_medium_break* to mono 48 kHz Opus in
  assets/audio/sfx/{bodysoft,bodyhard,bodybreak}/ (levels as they are) and merges them into assets/audio/manifest.json
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
DEFAULT = r"D:\SteamLibrary\steamapps\common\sourcefilmmaker\game\hl2\sound\physics\body"
SID = "hl2-physics-body"
KINDS = [("bodysoft", r"body_medium_impact_soft(\d+)\.wav"), ("bodyhard", r"body_medium_impact_hard(\d+)\.wav"),
         ("bodybreak", r"body_medium_break(\d+)\.wav")]


def duration(path):
    r = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else DEFAULT
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    files = sorted(os.listdir(src))
    for kind, pat in KINDS:
        folder = os.path.join(OUT, "sfx", kind)
        os.makedirs(folder, exist_ok=True)
        clips = []
        for f in files:
            m = re.fullmatch(pat, f)
            if not m:
                continue
            rel = f"sfx/{kind}/{kind}_{int(m[1]):03d}.ogg"
            r = subprocess.run([FFMPEG, "-y", "-i", os.path.join(src, f), "-ac", "1", "-ar", "48000", "-c:a", "libopus", "-b:a", "64k",
                                os.path.join(OUT, rel)], capture_output=True, text=True)
            if r.returncode == 0:
                d = round(duration(os.path.join(src, f)), 3)
                clips.append({"file": rel, "dur": d, "rms": None, "f0": None, "src": {"video": SID, "file": f, "t0": 0, "t1": d},
                              "conf": None, "origin": "valve"})
        man["sfx"][kind] = clips
        print(kind, len(clips), "clips")
    man["sources"] = [s for s in man.get("sources", []) if s["id"] != SID]
    man["sources"].append({"id": SID, "url": "https://store.steampowered.com/app/220/HalfLife_2/", "title": "Half-Life 2: sound/physics/body",
                           "author": "Valve"})
    json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
