"""Step 0: download best-quality audio of all source videos (yt-dlp) as WAV into _src/audio/."""
import subprocess
import sys
from common import SRC, SOURCES, SFX_SOURCES

PY = r"C:/Program Files/Python313/python.exe"   # system Python that has yt-dlp


def main():
    SRC.mkdir(parents=True, exist_ok=True)
    for s in SOURCES + SFX_SOURCES:
        if (SRC / f"{s['id']}.wav").exists() and "--force" not in sys.argv:
            continue
        subprocess.run([PY, "-m", "yt_dlp", "-f", "bestaudio", "-x", "--audio-format", "wav",
                        "--ffmpeg-location", "C:/ffmpeg/bin", "--write-info-json", "-q",
                        "-o", str(SRC / f"{s['id']}.%(ext)s"), s["url"]], check=True)
        print("downloaded", s["id"])


if __name__ == "__main__":
    main()
