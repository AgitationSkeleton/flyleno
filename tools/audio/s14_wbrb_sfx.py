"""
The "We'll Be Right Back" sting (The Eric Andre Show), for the freeze-frame gag: the end of
https://www.youtube.com/watch?v=8d0apIpKMh8 from 0:29 until it has faded out (0:33.4).

    python tools/audio/s14_wbrb_sfx.py        (system Python, yt-dlp and ffmpeg)

- downloads the audio to assets/_src/audio/wbrb/ (git-ignored)
- cuts it, loudness-normalises to -16 LUFS (it plays on its own, everything else silenced), mono 48 kHz Opus
- writes assets/audio/sfx/wbrb/wbrb_001.ogg and merges it into assets/audio/manifest.json
"""
import glob
import json
import os
import shutil
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "assets", "_src", "audio", "wbrb")
OUT = os.path.join(ROOT, "assets", "audio")
FFMPEG = shutil.which("ffmpeg") or r"C:\ffmpeg\bin\ffmpeg.exe"
YTDLP = shutil.which("yt-dlp") or "yt-dlp"
VID, T0, T1 = "8d0apIpKMh8", 29.0, 33.4


def main():
    os.makedirs(SRC, exist_ok=True)
    src = next(iter(glob.glob(os.path.join(SRC, VID + ".*"))), None)
    if not src:
        subprocess.run([YTDLP, "--no-warnings", "-f", "bestaudio", "-o", os.path.join(SRC, VID + ".%(ext)s"),
                        "https://www.youtube.com/watch?v=" + VID], check=True)
        src = glob.glob(os.path.join(SRC, VID + ".*"))[0]
    os.makedirs(os.path.join(OUT, "sfx", "wbrb"), exist_ok=True)
    rel = "sfx/wbrb/wbrb_001.ogg"
    d = T1 - T0
    subprocess.run([FFMPEG, "-y", "-ss", f"{T0:.3f}", "-t", f"{d:.3f}", "-i", src, "-ac", "1", "-ar", "48000",
                    "-af", "afade=t=in:d=0.01,loudnorm=I=-16:TP=-1.5:LRA=11", "-c:a", "libopus", "-b:a", "96k",
                    os.path.join(OUT, rel)], check=True, capture_output=True)
    man_path = os.path.join(OUT, "manifest.json")
    man = json.load(open(man_path, encoding="utf-8"))
    man["sfx"]["wbrb"] = [{"file": rel, "dur": round(d, 3), "rms": None, "f0": None, "src": {"video": VID, "t0": T0, "t1": T1},
                           "conf": None, "origin": "youtube"}]
    man["sources"] = [s for s in man.get("sources", []) if s["id"] != VID]
    man["sources"].append({"id": VID, "url": "https://www.youtube.com/watch?v=" + VID,
                           "title": "Eric Andre Show We'll Be Right Back Full Song"})
    json.dump(man, open(man_path, "w", encoding="utf-8"), indent=1)
    print("wbrb", rel, f"{d:.1f} s")


if __name__ == "__main__":
    main()
