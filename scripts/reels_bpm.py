"""BPM for one cached song preview (D-175). Prints JSON to stdout.

Uses librosa's default beat tracker. Its defaults (a 120 BPM starting guess,
22,050 Hz analysis) are printed with the reading so they can be reviewed at
gate 1 rather than hidden (R4).
"""

import json
import sys

import librosa
import numpy as np

SR = 22_050
START_BPM = 120.0


def main(path: str) -> None:
    y, sr = librosa.load(path, sr=SR, mono=True)
    if y.size == 0 or float(np.max(np.abs(y))) == 0.0:
        bpm = None
    else:
        tempo, _ = librosa.beat.beat_track(y=y, sr=sr, start_bpm=START_BPM)
        bpm = float(np.atleast_1d(tempo)[0]) or None
    print(json.dumps({
        "bpm": bpm,
        "library": f"librosa {librosa.__version__}",
        "settings": {"sr": SR, "start_bpm": START_BPM, "method": "beat.beat_track"},
    }))


if __name__ == "__main__":
    main(sys.argv[1])
