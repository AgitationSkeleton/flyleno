"""Step 2: faster-whisper large-v3 transcription of the vocals stem, word timestamps."""
import sys
import torch  # noqa: F401  (loads CUDA/cuDNN DLLs that ctranslate2 needs on Windows)
from faster_whisper import WhisperModel
from common import SRC, IDS, stem, load, jdump

def main():
    model = WhisperModel("large-v3", device="cuda", compute_type="float16")
    for vid in IDS:
        out = SRC / "transcripts" / f"{vid}.json"
        if out.exists() and "--force" not in sys.argv:
            print("skip", vid); continue
        x, sr = load(stem(vid, "vocals"), sr=16000)
        segs, info = model.transcribe(
            x, language="en", word_timestamps=True, beam_size=5,
            condition_on_previous_text=False, vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 150})
        res = []
        for s in segs:
            res.append({"t0": s.start, "t1": s.end, "text": s.text.strip(),
                        "avg_logprob": s.avg_logprob, "no_speech_prob": s.no_speech_prob,
                        "words": [{"w": w.word.strip(), "t0": w.start, "t1": w.end, "p": w.probability}
                                  for w in (s.words or [])]})
            print(f"{s.start:7.2f}-{s.end:7.2f} {s.text.strip()}")
        jdump({"id": vid, "segments": res}, out)

if __name__ == "__main__":
    main()
