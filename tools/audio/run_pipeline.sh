#!/usr/bin/env bash
# Re-runs the whole Grey Leno sound-bank pipeline. Each step skips work already done
# unless --force is passed to it. Run from Git Bash on Windows.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(cd ../.. && pwd)"
VENV_PY="${VENV_PY:-/d/Claude_FruitFly/tools/audio-venv/Scripts/python.exe}"
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
export HF_HOME="${HF_HOME:-$ROOT/assets/_src/audio/models/hf}"
"$VENV_PY" s00_download.py
"$VENV_PY" s01_separate.py
"$VENV_PY" s02_transcribe.py
"$VENV_PY" s03_diarize.py
"$VENV_PY" s04_tag.py
"$VENV_PY" s05_align.py
"$VENV_PY" s06_leno_units.py
"$VENV_PY" s07_sfx.py
"$VENV_PY" s08_manifest.py
"$VENV_PY" s09_qc.py
