# Trial Reels CLAP endpoint (D-177)

The song pool's tagger and the song pick's narrowing both call this endpoint.
It runs `laion/larger_clap_music_and_speech` behind the custom handler in `handler.py`,
which returns L2-normalized audio and text embeddings.

## Set it up (Lucas, once)

1. Create a Hugging Face account with a payment method.
2. Create a model repository (private is fine). Put `handler.py` and
   `requirements.txt` from this folder in it.
3. Create an Inference Endpoint from that repository:
   - Task: Custom.
   - Instance: a CPU instance with at least 8 GB of memory. The model is about
     200M parameters, and the smallest 4 GB CPU is tight. Check the hourly
     price on the endpoint page before creating it.
   - Scale to zero after 15 minutes idle, so it bills only while the ingest or
     a song pick is running. The first call after it sleeps waits a few minutes;
     the client retries through the 503s.
   - Security: protected (token required).
4. Create a fine-grained token that can call Inference Endpoints (a read
   token also works), and put both values in `.env.local` and
   `scripts/gcp/worker.env`:

   ```
   HF_TOKEN=hf_...
   HF_CLAP_ENDPOINT_URL=https://....endpoints.huggingface.cloud
   ```

   Then redeploy the worker (`./scripts/gcp/deploy-worker-code.sh`).

## Contract

```
POST {"inputs": {"texts": ["This is lo-fi music.", ...]}}
  -> {"text_embeddings": [[...], ...], "model": "laion/larger_clap_music_and_speech"}

POST {"inputs": {"audio_pcm_f32_b64": "<48 kHz mono float32 LE>", "sample_rate": 48000}}
  -> {"audio_embedding": [...], "windows": 3, "model": "laion/larger_clap_music_and_speech"}
```

Audio longer than 10 s is embedded in consecutive 10 s windows (up to 9) and
averaged. A trailing window under 5 s is dropped unless it is the only one.

## Updating the handler

An endpoint serves the repository commit it was created from. After uploading
a new `handler.py`, open the endpoint's Settings, point its revision at the
latest commit (or clear the pinned revision), and update it. Check it took:
the endpoint's replies include `"model"`, which must name the checkpoint in
the new handler.
