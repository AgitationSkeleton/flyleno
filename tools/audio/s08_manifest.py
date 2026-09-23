"""Step 8: assemble assets/audio/manifest.json from the per-stage unit files.

Safe to run at any time: categories whose stage has not run yet are written empty, so the
live app always gets a valid manifest. QC-only fields (keys starting with '_') are stripped
here and kept in _src/audio/units/*.json. Written atomically (temp file + rename)."""
import json
import os
from common import SRC, OUT, SOURCES, SFX_SOURCES, jload

SFX_KEYS = ["retch", "vomit", "fart", "pipe", "splat"]
CROWD_KEYS = ["boo", "gasp", "cheer", "laugh", "applause"]


def strip(c):
    return {k: v for k, v in c.items() if not k.startswith("_")}


def main():
    leno = {"phonemes": {}, "syllables": [], "mutters": [], "words": []}
    p = SRC / "units" / "leno_units.json"
    if p.exists():
        u = jload(p)["leno"]
        leno = {"phonemes": {k: [strip(c) for c in v] for k, v in u["phonemes"].items()},
                "syllables": [strip(c) for c in u["syllables"]],
                "mutters": [strip(c) for c in u["mutters"]],
                "words": [strip(c) for c in u["words"]]}
    sfx = {k: [] for k in SFX_KEYS}
    crowd = {k: [] for k in CROWD_KEYS}
    p = SRC / "units" / "sfx_units.json"
    used = set()
    if p.exists():
        u = jload(p)
        for k in SFX_KEYS:
            sfx[k] = [strip(c) for c in u.get("sfx", {}).get(k, [])]
        for k in CROWD_KEYS:
            crowd[k] = [strip(c) for c in u.get("crowd", {}).get(k, [])]
    for grp in list(sfx.values()) + list(crowd.values()):
        for c in grp:
            used.add(c["src"]["video"])
    # every clip file must exist
    allclips = [c for v in leno["phonemes"].values() for c in v] + leno["syllables"] + leno["mutters"] + \
        leno["words"] + [c for g in list(sfx.values()) + list(crowd.values()) for c in g]
    missing = [c["file"] for c in allclips if not (OUT / c["file"]).exists()]
    if missing:
        raise SystemExit("missing clip files: %s" % missing[:5])
    sources = SOURCES + [s for s in SFX_SOURCES if s["id"] in used]
    man = {"version": 1, "sources": sources, "leno": leno, "sfx": sfx, "crowd": crowd}
    OUT.mkdir(parents=True, exist_ok=True)
    tmp = OUT / "manifest.json.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(man, f, ensure_ascii=False, indent=1)
    os.replace(tmp, OUT / "manifest.json")
    print("manifest: %d clips" % len(allclips))


if __name__ == "__main__":
    main()
