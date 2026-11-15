# VTT Transcribe Web

A static, serverless web app that transcribes audio/video **in your browser**. There is no backend.

**On-device is the default** and needs no key. OpenAI is an explicit opt-in (tick "Use OpenAI instead" and paste your own key); nothing is sent to OpenAI unless you do.

Two engines behind one interface (`transcribe(audio, options) -> segments`):

| Engine | How | Key needed | Where the audio goes |
|---|---|---|---|
| **OpenAI Whisper (BYOK)** | Browser `POST`s straight to `https://api.openai.com/v1/audio/transcriptions` (`whisper-1`, `verbose_json`, segment timestamps). Files over 24 MB are decoded, resampled to 16 kHz mono and sent in 10-minute WAV chunks (OpenAI's limit is 25 MB). | Your own OpenAI key | Browser → OpenAI only |
| **On this device** | [transformers.js](https://github.com/huggingface/transformers.js) runs Whisper (tiny/base/small, ONNX) with WebGPU if an adapter exists, else WebAssembly. Lazy-loaded; decodes audio with the Web Audio API. | None | Nowhere. Only the model weights are downloaded (Hugging Face), once, then cached by the browser. |

Export: SRT, VTT, TXT, JSON. Light/dark/auto theme, mobile-friendly.

## Privacy claims and how to verify them

* The OpenAI key is held in memory. It is written to `localStorage` **only** if you tick "Remember the key" (and removed when you untick it and transcribe again).
* The key is sent only in the `Authorization` header to `api.openai.com`.
* On-device mode makes no request carrying your audio; the only external hosts are Hugging Face for model weights.
* The ONNX Runtime WebAssembly is served from this origin (`/ort/`), not a CDN.

Verify: open DevTools → Network while transcribing (only your origin, `api.openai.com`, and in on-device mode `huggingface.co`/`*.hf.co`). `index.html` also ships a strict Content-Security-Policy `connect-src` allow-list, so the browser itself blocks any other destination; that policy is how we caught transformers.js trying to fetch code from jsdelivr, which is why ORT is self-hosted. The e2e tests assert the host set.

## Known limits

* Browser-side decoding uses `decodeAudioData`: whole file in memory, and only formats/codecs your browser supports (mp4/mov need a decodable audio track). A very long recording (hours) may exhaust memory. ffmpeg.wasm is not included.
* On-device mode cannot auto-detect language (assumes English unless chosen); quality is below OpenAI; segments come from fixed 30 s windows so a word on a boundary can be split.
* OpenAI returns no CORS header on 401 responses, so a wrong key looks like a network error to the browser; the UI says so.
* `whisper-1` is used because it is the OpenAI model that returns segment timestamps.

## Develop and test (no node on the host needed)

```bash
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npm install
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npx vitest run          # unit tests
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npx svelte-check        # types
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp --ipc=host -v "$PWD":/w -w /w \
  mcr.microsoft.com/playwright:v1.49.1-jammy npx playwright test                                         # e2e (mocked OpenAI, stub model)
# real model, opt-in (downloads from Hugging Face, WASM in headless Chromium):
docker run ... -e REAL_MODEL=tiny ... npx playwright test real-model --project=desktop
```

Everything is tested locally; GitHub Actions are intentionally disabled on this repo. Do not host publicly until ready. Note: the `/ort` runtime files include an 11 MB `.wasm`; a host with a 25 MB per-file limit is fine, but check any other limits.

Layout: `src/lib/{openai,local,audio,format,settings,types}.ts` (engines and helpers), `src/components/*`, `e2e/*`.

## Translation and speakers

- **Translate**: pick a target language. OpenAI mode uses a chat model (`gpt-4o-mini`) in numbered batches; on-device mode uses small Opus-MT models (about 75 MB per pair, non-English pairs pivot via English) and is rougher. Exports and the viewer can show the original or the translation.
- **Speakers**: tick "Identify the speakers". Detection always runs on your device (pyannote-segmentation-3.0 + a WavLM x-vector, about 100 MB, cached). You then review each speaker: play samples, rename, **merge** voices that are one person, or **split** one that is two. Names are written into the transcript and exports (`Ada: text`).
- **Accuracy**: on 3-minute two/three-speaker test conversations the automatic count was correct on 2 of 4, otherwise too high (over-splitting is deliberate: merging is one click), with 79-100% of speaking time attributed correctly. Choosing the speaker count up front uses it exactly. Overlapping speech is not separated.
- Opt-in real-model check: `REAL_DIARIZE=/path/to/audio.wav` (with a matching `.rttm`) `npx playwright test real-diarize --project=desktop`.
