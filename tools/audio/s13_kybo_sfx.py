"""
Kybo Rin's sounds, used as they are from assets/audio/sfx/kylo/ (no conversion):
  - kylorant.mp3: his rant (a meme remix), 83 s. Registered as `music.kylorant`, a group the audio preload skips:
    it is fetched when he walks on
  - SABER/*.WAV: Star Wars lightsaber sounds (ignition, hum loops, swings, smacks, clashes, sparks, power-off)

    python tools/audio/s13_kybo_sfx.py

- merges the kinds below into assets/audio/manifest.json (re-runnable)
"""
import json
import os
import re
import shutil
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "assets", "audio")
FFMPEG = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"
DIR = "sfx/kylo"
SABER = {
    "saberon": ["SABERONJ"],
    "saberoff": ["SABEROFFJ"],
    "saberhum": ["SABERLOOPJ", "SABERLOOPB"],          # the first is the one he uses
    "saberswing": ["SABERMOVE1", "SABERMOVE2", "SABERMOVE3", "SABERMOVE4", "COMBOSABER1", "COMBOSABER2"],
    "saberhit": ["SABERSMACK01", "SABERSMACK02", "SABERSMACK03", "SABERSMACK05", "SABERSPARKS"],
    "saberclash": ["SABERSABER01", "SABERSABER02", "SABERSABER03", "SABERSABER04", "SABDEFBLAS1", "SABDEFBLAS2", "SABDEFBLAS3", "SABDEFBLAS4"],
    "saberfield": ["SABFFIELD1", "SABFFIELD2"],
}


def duration(path):
    r = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True)
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", r.stderr)
    return int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]) if m else 0


def clip(rel, sid):
    d = round(duration(os.path.join(OUT, rel)), 3)
    return {"file": rel, "dur": d, "rms": None, "f0": None, "src": {"video": sid, "file": os.path.basename(rel), "t0": 0, "t1": d},
            "conf": None, "origin": "kybo"}


def main():
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    man.setdefault("music", {})["kylorant"] = [clip(f"{DIR}/kylorant.mp3", "kybo-rant")]
    for kind, names in SABER.items():
        man["sfx"][kind] = [clip(f"{DIR}/SABER/{n}.WAV", "kybo-saber") for n in names]
        print(kind, len(names))
    man["sources"] = [s for s in man.get("sources", []) if s["id"] not in ("kybo-rant", "kybo-saber")]
    man["sources"].append({"id": "kybo-rant", "url": "", "title": "kylorant.mp3 (a Kylo Ren rant meme remix)", "author": "unknown"})
    man["sources"].append({"id": "kybo-saber", "url": "", "title": "Star Wars lightsaber sounds (SABER)", "author": "Lucasfilm"})
    json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)


if __name__ == "__main__":
    main()
