"""Generate synthetic Mandarin WAVs on macOS; never records a person's microphone."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import wave

SENTENCES = {
    "content": "今天女儿来看我了，我们一起喝茶。",
    "stop": "就先说到这里，停止。",
    "save": "保存这篇日记。",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    metadata = {"source": "macOS say Tingting, 145 words/minute; synthetic speech", "fixtures": []}
    for name, text in SENTENCES.items():
        aiff, converted, target = [args.output / (name + suffix) for suffix in (".aiff", ".converted.wav", ".wav")]
        subprocess.run(["say", "-v", "Tingting", "-r", "145", "-o", str(aiff), text], check=True)
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(aiff), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(converted)], check=True)
        # Keep a minimal RIFF PCM header and remove optional encoder metadata.
        with wave.open(str(converted), "rb") as source:
            params, pcm = source.getparams(), source.readframes(source.getnframes())
        with wave.open(str(target), "wb") as dest:
            dest.setparams(params)
            dest.writeframes(pcm)
        metadata["fixtures"].append({"name": name, "text": text, "file": target.name,
                                     "duration_seconds": params.nframes / params.framerate,
                                     "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    (args.output / "fixtures.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
