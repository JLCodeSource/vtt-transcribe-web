<script lang="ts">
  import EnginePicker, { type EngineChoice } from './components/EnginePicker.svelte';
  import Dropzone from './components/Dropzone.svelte';
  import ProgressView from './components/ProgressView.svelte';
  import TranscriptViewer from './components/TranscriptViewer.svelte';
  import SpeakerReview from './components/SpeakerReview.svelte';
  import { OpenAIEngine } from './lib/openai';
  import { LocalEngine } from './lib/local';
  import { languageName } from './lib/languages';
  import { OpenAITranslator, LocalTranslator } from './lib/translate';
  import { Diarizer } from './lib/diarize';
  import { decodeToMono16k } from './lib/audio';
  import { labelSegments, type SpeakerNames, type Turn } from './lib/speakers';
  import { EngineError, type Progress, type Segment } from './lib/types';
  import { applyTheme, forgetKey, loadSavedKey, loadTheme, saveKey, type Theme } from './lib/settings';

  const saved = loadSavedKey();
  let engine = $state<EngineChoice>('local');
  let apiKey = $state(saved);
  let remember = $state(!!saved);
  let model = $state('base');
  let language = $state('auto');
  let theme = $state<Theme>(loadTheme());
  let file = $state<File | null>(null);
  let progress = $state<Progress | null>(null);
  let target = $state('');
  let diarize = $state(false);
  let speakerCount = $state('auto');
  let raw = $state<Segment[] | null>(null);
  let ranOn = $state('');
  /** language Whisper detected on-device; the translator needs it as its source language */
  let detectedLang = $state('');
  let turns = $state<Turn[] | null>(null);
  let names = $state<SpeakerNames>({});
  let reviewing = $state(false);
  const segments = $derived(raw && turns ? labelSegments(raw, turns, names) : raw);
  const diarizer = new Diarizer();
  let error = $state('');
  let abort: AbortController | null = null;

  applyTheme(loadTheme());
  const cycle = () => {
    theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    applyTheme(theme);
  };

  const canStart = $derived(!!file && !progress && (engine === 'local' || apiKey.trim().length > 0));
  const basename = $derived((file?.name ?? 'transcript').replace(/\.[^.]+$/, ''));

  async function start() {
    if (!file) return;
    error = '';
    if (engine === 'openai') (remember ? saveKey(apiKey.trim()) : forgetKey());
    abort = new AbortController();
    const signal = abort.signal;
    const onProgress = (p: Progress) => (progress = p);
    progress = { phase: 'decode', fraction: null, message: 'Starting…' };
    try {
      const eng = engine === 'openai' ? new OpenAIEngine({ apiKey }) : new LocalEngine({ model });
      const segs = await eng.transcribe(file, { language, signal, onProgress });
      ranOn = eng instanceof LocalEngine
        ? (eng.device === 'webgpu' ? 'on this device, GPU (WebGPU)' : 'on this device, CPU (WebAssembly)') +
          (eng.detectedLanguage ? `; detected language: ${languageName(eng.detectedLanguage)}` : '')
        : 'by OpenAI';
      detectedLang = eng instanceof LocalEngine ? (eng.detectedLanguage ?? '') : '';
      raw = segs;
      if (diarize && segs.length) {
        progress = { phase: 'decode', fraction: null, message: 'Preparing audio for speaker detection…' };
        const pcm = await decodeToMono16k(file);
        turns = await diarizer.run(pcm, {
          speakers: speakerCount === 'auto' ? undefined : Number(speakerCount),
          signal,
          onProgress,
        });
        reviewing = turns.length > 0;
        if (!turns.length) turns = null;
      }
      // Order: transcribe -> diarize (+ human speaker review, in the original language) -> translate.
      // Translation is deferred until the speakers are confirmed, see finishAfterReview().
      if (!reviewing && target) raw = await translateAll(segs, signal, onProgress);
    } catch (e) {
      if (!(e instanceof EngineError && e.kind === 'aborted')) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      }
      // keep whatever finished (e.g. transcript when only speaker detection failed)
    } finally {
      progress = null;
      abort = null;
    }
  }

  async function translateAll(segs: Segment[], signal: AbortSignal, onProgress: (p: Progress) => void): Promise<Segment[]> {
    const tr = engine === 'openai' ? new OpenAITranslator({ apiKey }) : new LocalTranslator();
    const out = await tr.translate(segs, { from: language === 'auto' && detectedLang ? detectedLang : language, to: target, signal, onProgress });
    return segs.map((s, i) => ({ ...s, translation: out[i] }));
  }

  /** Translation runs only after the speakers have been reviewed (or skipped). */
  async function finishAfterReview() {
    reviewing = false;
    if (!target || !raw || raw.some((s) => s.translation !== undefined)) return;
    error = '';
    abort = new AbortController();
    const signal = abort.signal;
    progress = { phase: 'transcribe', fraction: null, message: 'Translating…' };
    try {
      raw = await translateAll(raw, signal, (p) => (progress = p));
    } catch (e) {
      if (!(e instanceof EngineError && e.kind === 'aborted')) {
        error = e instanceof Error ? e.message : 'Translation failed.';
      }
    } finally {
      progress = null;
      abort = null;
    }
  }
  function confirmSpeakers(t: Turn[], n: SpeakerNames) {
    turns = t;
    names = n;
    void finishAfterReview();
  }
  function skipSpeakers() {
    turns = null;
    void finishAfterReview();
  }
  function reset() {
    raw = null;
    turns = null;
    names = {};
    reviewing = false;
    file = null;
    error = '';
  }
</script>

<main>
  <header class="top">
    <div>
      <h1>VTT Transcribe</h1>
      <p class="tag">Audio to text, right in your browser. No account, no server.</p>
    </div>
    <button type="button" onclick={cycle} aria-label="Theme: {theme}. Click to change.">
      {theme === 'dark' ? '🌙 Dark' : theme === 'light' ? '☀️ Light' : '🖥 Auto'}
    </button>
  </header>

  {#if error}
    <div class="error" role="alert">{error}</div>
  {/if}

  {#if progress}
    <ProgressView {progress} oncancel={() => abort?.abort()} />
  {:else if raw && reviewing && turns && file}
    <SpeakerReview {turns} {names} segments={raw} {file} onconfirm={confirmSpeakers} onskip={skipSpeakers} />
  {:else if segments}
    {#if ranOn}<p class="ranon" data-testid="ran-on">Transcribed {ranOn}.</p>{/if}
    <TranscriptViewer
      {segments}
      {basename}
      onreset={reset}
      onspeakers={turns ? () => (reviewing = true) : undefined}
    />
  {:else}
    <EnginePicker bind:engine bind:apiKey bind:remember bind:model bind:language bind:target bind:diarize bind:speakerCount />
    <Dropzone {file} onfile={(f) => ((file = f), (error = ''))} />
    <div class="go">
      <button type="button" class="primary" disabled={!canStart} onclick={start}>{target || diarize ? "Transcribe & process" : "Transcribe"}</button>
      {#if file && engine === 'openai' && !apiKey.trim()}
        <span class="hint">Enter your API key to continue.</span>
      {/if}
    </div>
  {/if}

  <footer>
    <p>
      Privacy: this page has no backend. In OpenAI mode your audio and key go only to api.openai.com. In on-device mode
      nothing is uploaded. See the README to verify.
    </p>
  </footer>
</main>

<style>
  main { max-width: 760px; margin: 0 auto; padding: 1rem 16px 3rem; display: grid; gap: 1rem; }
  .top { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; }
  h1 { margin: 0; font-size: 1.6rem; }
  .tag { margin: 0; color: var(--muted); }
  .error { background: var(--err-bg); color: var(--err); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid var(--err); }
  .go { display: flex; gap: 1rem; align-items: center; }
  .hint, .ranon { color: var(--muted); font-size: 0.9rem; margin: 0; }
  footer { color: var(--muted); font-size: 0.85rem; margin-top: 1rem; }
</style>
