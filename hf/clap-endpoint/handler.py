"""Custom handler for the Trial Reels CLAP endpoint (D-177).

Deploy `laion/larger_clap_music_and_speech` on a Hugging Face Inference Endpoint with this
file and requirements.txt in the repository the endpoint points at. The Hub
calls it with {"inputs": {...}}:

  {"inputs": {"texts": ["..."]}}
      -> {"text_embeddings": [[...], ...], "model": "..."}
  {"inputs": {"audio_pcm_f32_b64": "<48 kHz mono float32 LE>", "sample_rate": 48000}}
      -> {"audio_embedding": [...], "windows": n, "model": "..."}

Every vector is L2-normalized, so a dot product is the cosine similarity.

Audio longer than one window is cut into consecutive 10 s windows (the
feature extractor's own length), each is embedded, and the mean is
re-normalized. The stock processor would otherwise crop at random, and a
rerun would tag a song differently.
"""

import base64
import os

import numpy as np
import torch
from transformers import ClapModel, ClapProcessor

MODEL_ID = "laion/larger_clap_music_and_speech"
SAMPLE_RATE = 48_000
WINDOW_SECONDS = 10
MAX_WINDOWS = 9


def _features(output) -> torch.Tensor:
    """transformers 4.x returns the projected tensor; 5.x wraps it in a ModelOutput."""
    if isinstance(output, torch.Tensor):
        return output
    for name in ("text_embeds", "audio_embeds", "pooler_output"):
        value = getattr(output, name, None)
        if isinstance(value, torch.Tensor):
            return value
    raise TypeError(f"Unexpected CLAP output: {type(output).__name__}")


def _normalize(vector: torch.Tensor) -> torch.Tensor:
    return vector / vector.norm(dim=-1, keepdim=True).clamp_min(1e-12)


class EndpointHandler:
    def __init__(self, path: str = ""):
        # The endpoint passes its own repository path, which holds only this
        # handler. Load the weights from the Hub unless the repo carries them.
        source = path if path and os.path.exists(os.path.join(path, "config.json")) else MODEL_ID
        self.model = ClapModel.from_pretrained(source).eval()
        self.processor = ClapProcessor.from_pretrained(source)

    @torch.no_grad()
    def __call__(self, data):
        inputs = data.get("inputs", data)
        if "texts" in inputs:
            tokens = self.processor(text=list(inputs["texts"]), return_tensors="pt", padding=True)
            features = _normalize(_features(self.model.get_text_features(**tokens)))
            return {"text_embeddings": features.tolist(), "model": MODEL_ID}

        rate = int(inputs.get("sample_rate", SAMPLE_RATE))
        if rate != SAMPLE_RATE:
            raise ValueError(f"Expected {SAMPLE_RATE} Hz audio, got {rate}.")
        pcm = np.frombuffer(base64.b64decode(inputs["audio_pcm_f32_b64"]), dtype="<f4")
        if pcm.size == 0:
            raise ValueError("Empty audio.")
        window = SAMPLE_RATE * WINDOW_SECONDS
        windows = [pcm[start:start + window] for start in range(0, pcm.size, window)][:MAX_WINDOWS]
        # A short tail window would be mostly padding; drop it unless it is all there is.
        if len(windows) > 1 and windows[-1].size < window // 2:
            windows = windows[:-1]
        # The feature extractor takes audio positionally on transformers 4.x and 5.x;
        # the processor renamed its keyword from `audios` to `audio` in 5.x.
        features = self.processor.feature_extractor(windows, sampling_rate=SAMPLE_RATE, return_tensors="pt")
        embedded = _normalize(_features(self.model.get_audio_features(**features)))
        mean = _normalize(embedded.mean(dim=0, keepdim=True))[0]
        return {"audio_embedding": mean.tolist(), "windows": len(windows), "model": MODEL_ID}
