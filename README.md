# VTT Transcribe Web

**Live site: https://jlcodesource.github.io/vtt-transcribe-web/**

Turn audio and video into text, entirely in your browser. There is no backend, no account and nothing to install.

- **Private by default.** Speech recognition (Whisper) runs on your own device. Your files are not uploaded anywhere. If you prefer, you can opt in to OpenAI with your own API key.
- **Several files at once.** Add as many as you like; they run one at a time and the results are kept in your browser for a few days.
- **Optional extras.** Translation, and "who spoke when" speaker labels you can review, rename, merge and split.
- **Export** as SRT, VTT, TXT or JSON. Light, dark and auto theme; works on phones.

## How to use it

1. Open the live site and drop in one or more audio or video files (mp3, wav, m4a, ogg, webm, mp4, mov).
2. Pick how to transcribe: **On this device** (default, no key, the first run downloads a model) or **OpenAI** (faster and more accurate, needs your key, uploads the audio to OpenAI).
3. Optionally pick the spoken language, a translation language and "Identify the speakers", then press **Transcribe**.
4. Watch progress in **Jobs**. When a result is ready, open it to read, search, review speakers and download it.
5. **Settings** controls how long results are kept, the remembered key, notifications, and "Delete all my data".

### The two engines

| Engine | How it works | Key | Where your audio goes |
|---|---|---|---|
| **On this device** (default) | [transformers.js](https://github.com/huggingface/transformers.js) runs Whisper (tiny, base or small) with WebGPU if available, otherwise WebAssembly. | None | Nowhere. Only the model files are downloaded from Hugging Face, once, then cached by your browser. |
| **OpenAI (bring your own key)** | The browser sends the audio straight to `api.openai.com` (`whisper-1`). Files over 24 MB are split into 10-minute chunks (OpenAI's limit is 25 MB). | Your own OpenAI key | Your browser to OpenAI only. |

## Translation and speakers

- **Translate**: pick a target language. OpenAI mode uses a chat model (`gpt-4o-mini`) in numbered batches; on-device mode uses small Opus-MT models (about 75 MB per pair, non-English pairs pivot via English) and is rougher. Exports and the viewer can show the original or the translation.
- **Speakers**: tick "Identify the speakers". Detection always runs on your device (pyannote-segmentation-3.0 + a WavLM x-vector, about 100 MB, cached). You then review each speaker (by default after transcription, detection and translation have all finished, so a batch runs to the end before it needs you; Settings → "Review the speakers before translating" asks first instead): play samples, rename, **merge** voices that are one person, or **split** one that is two. Names are written into the transcript and exports (`Ada: text`).
- **Accuracy**: on 3-minute two/three-speaker test conversations the automatic count was correct on 2 of 4, otherwise too high (over-splitting is deliberate: merging is one click), with 79-100% of speaking time attributed correctly. Choosing the speaker count up front uses it exactly. Overlapping speech is not separated.
- Opt-in real-model check: `REAL_DIARIZE=/path/to/audio.wav` (with a matching `.rttm`) `npx playwright test real-diarize --project=desktop`.

## Privacy claims and how to verify them

* The OpenAI key is held in memory. It is written to `localStorage` **only** if you turn on "Remember my OpenAI key on this device" in Settings (unencrypted; anyone using that browser profile can read it). Turning it off removes it.
* Finished results (transcript segments, speaker turns and names, translation) are saved **only in this browser** (IndexedDB, database `vtt-transcribe`), so they survive a reload. The API key and the audio are not part of a saved result. The audio is kept only if you tick "Also keep the audio file" in Settings (off by default; it is needed only to play speaker samples when reviewing later) and is deleted together with its result. Nothing is uploaded to us: there is no server.
* Results are kept for the retention you choose: keep until deleted, delete after download, or hold N days (platform default: **7 days**), set as a default in Settings and per result in Jobs. Expired results are deleted when the page loads and every minute while it is open. "Delete all my data" in Settings removes every result, any kept audio, settings, the saved key and the cached on-device models.
* Preferences (default retention, notification opt-in, keep-audio, theme) are small `localStorage` entries starting with `vtt.`.
* Notifications are optional browser notifications, requested only when you turn them on; the page must stay open. Nothing is sent anywhere.
* The key is sent only in the `Authorization` header to `api.openai.com`.
* On-device mode makes no request carrying your audio; the only external hosts are Hugging Face for model weights.
* The ONNX Runtime WebAssembly is served from this origin (`/ort/`), not a CDN.

Verify: open DevTools → Network while transcribing (only your origin, `api.openai.com`, and in on-device mode `huggingface.co`/`*.hf.co`). `index.html` also ships a strict Content-Security-Policy `connect-src` allow-list, so the browser itself blocks any other destination; that policy is how we caught transformers.js trying to fetch code from jsdelivr, which is why ORT is self-hosted. The e2e tests assert the host set.

## Queue, Jobs and what is not included

Pick several files and they run **one at a time, first in first out** (the models are heavy in a browser tab; nothing runs concurrently). The Jobs view shows each item's step (download model, transcribe, identify speakers, translate), the percent through the audio where the engine reports one, the queue position of waiting items, and Cancel for waiting or running items. Finished results appear under "Saved in this browser" where you can re-open, review speakers, download or delete them. The tab title shows progress, and an optional notification tells you when a job finishes or fails while the tab is in the background.

Queued items hold their files in memory, so **closing the tab drops anything still waiting or running**; only finished results persist. If the browser refuses to store a result (quota, private mode) the Jobs view says so and keeps it in memory for this tab so you can download it.

Out of scope for a static app with no server: **email notifications, accounts and cross-device history.** Results exist only in the browser that made them, and clearing site data deletes them.

## Known limits

* Browser-side decoding uses `decodeAudioData`: whole file in memory, and only formats/codecs your browser supports (mp4/mov need a decodable audio track). A very long recording (hours) may exhaust memory. ffmpeg.wasm is not included (see below).
* Why no ffmpeg.wasm: the browser already decodes mp3, wav, m4a, ogg, webm and mp4 audio, so ffmpeg would only add rarer formats (mkv, avi, wma) at the cost of a ~30 MB download, a single-threaded (slow) build on GitHub Pages, which cannot send the headers multithreading needs, and licensing to check (the stock ffmpeg.wasm core is GPL-licensed, this project is BSD-3). It could be added later as an optional fallback that is downloaded only when a file fails to decode.
* On-device mode detects the language from the first 30 seconds (pick it yourself if the recording starts with silence or music); quality is below OpenAI; segments come from fixed 30 s windows, so a word on a boundary can be split.
* Long recordings and on-device memory: each processing stage frees its model before the next loads, but a very large file or the Small model on a low-memory device can still run out of memory. Use a smaller model or OpenAI mode.
* OpenAI returns no CORS header on 401 responses, so a wrong key looks like a network error to the browser; the UI says so.
* `whisper-1` is used because it is the OpenAI model that returns segment timestamps.

## For developers: build and test (no node needed on the host)

```bash
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npm install
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npx vitest run          # unit tests
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npx svelte-check        # types
./scripts/e2e.sh                  # full e2e suite in a container (builds Dockerfile.e2e once)
./scripts/e2e.sh --project=real   # any `playwright test` arguments
# The suite runs on Chromium, Pixel-7 emulation, Firefox, WebKit and branded Chrome (AAC video), plus a 'real'
# project (real tiny Whisper and real speaker models, downloaded from Hugging Face) and, when the host has an
# NVIDIA GPU and the NVIDIA container toolkit (CDI), a 'gpu' project that runs Whisper on WebGPU. e2e.sh detects
# the GPU automatically; without one the gpu project simply isn't part of the run.
```

Everything is tested locally in containers. The site is deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `main`. Note: the `/ort` runtime files include `.wasm` files of about 27-28 MB each; that is under GitHub's 100 MB per-file limit, but a host with a 25 MB per-file limit would not work.

Layout: `src/lib/{openai,local,audio,format,settings,types}.ts` (engines and helpers), `src/lib/{queue,store,retention,service,pipeline,notify}.ts` (job queue, IndexedDB store, retention rules, glue), `src/components/*`, `e2e/*`.

## Test files to try

Sample media for trying the app by hand lives in [`e2e/fixtures/`](e2e/fixtures/) (the same files the tests use):

| File | Good for |
|---|---|
| `hello_conversation.mp3` | a basic transcription |
| `speech-fr.mp3`, `speech-es.mp3` | language detection and translation |
| `two-voices.wav` (+ `two-voices.rttm`, the exact speaker turns) | speaker identification and review |
| `video-vp8-opus.webm`, `video-vp9-opus.mp4`, `video-h264-mp3.mp4`, `video-theora-vorbis.ogv`, `video-h264-aac.mp4` | video containers (the AAC one needs Chrome, Firefox or Safari, not open-source Chromium) |

Select several at once to see the queue work.

## Test fixtures and keys
No OpenAI key is needed to build, test or regenerate anything. OpenAI tests run against a mocked endpoint with a fake key, and the
speech fixtures in `e2e/fixtures/` (a two-voice conversation with exact speaker turns, French and Spanish clips) are generated by
`./scripts/gen-fixtures.sh` with Piper, an open-source TTS (voices are downloaded once into `.cache/piper`).

## Publishing
See `docs/PUBLISHING.md` (GitHub Pages, sub-path build, verification steps).

## License
BSD 3-Clause (see `LICENSE`). Third-party software, models and test-data credits are in `NOTICE`. The speech and translation
models are not part of this repository; they are downloaded by the visitor's browser from Hugging Face on first use.
