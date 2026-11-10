<script lang="ts">
  import EnginePicker, { type EngineChoice } from './components/EnginePicker.svelte';
  import Dropzone from './components/Dropzone.svelte';
  import ProgressView from './components/ProgressView.svelte';
  import TranscriptViewer from './components/TranscriptViewer.svelte';
  import { OpenAIEngine } from './lib/openai';
  import { LocalEngine } from './lib/local';
  import { EngineError, type Progress, type Segment } from './lib/types';
  import { applyTheme, forgetKey, loadSavedKey, loadTheme, saveKey, type Theme } from './lib/settings';

  const saved = loadSavedKey();
  let engine = $state<EngineChoice>('openai');
  let apiKey = $state(saved);
  let remember = $state(!!saved);
  let model = $state('base');
  let language = $state('auto');
  let theme = $state<Theme>(loadTheme());
  let file = $state<File | null>(null);
  let progress = $state<Progress | null>(null);
  let segments = $state<Segment[] | null>(null);
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
    progress = { phase: 'decode', fraction: null, message: 'Starting…' };
    try {
      const eng = engine === 'openai' ? new OpenAIEngine({ apiKey }) : new LocalEngine({ model });
      segments = await eng.transcribe(file, { language, signal: abort.signal, onProgress: (p) => (progress = p) });
    } catch (e) {
      if (!(e instanceof EngineError && e.kind === 'aborted')) {
        error = e instanceof Error ? e.message : 'Something went wrong.';
      }
    } finally {
      progress = null;
      abort = null;
    }
  }
  function reset() {
    segments = null;
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

  {#if segments}
    <TranscriptViewer {segments} {basename} onreset={reset} />
  {:else if progress}
    <ProgressView {progress} oncancel={() => abort?.abort()} />
  {:else}
    <EnginePicker bind:engine bind:apiKey bind:remember bind:model bind:language />
    <Dropzone {file} onfile={(f) => ((file = f), (error = ''))} />
    <div class="go">
      <button type="button" class="primary" disabled={!canStart} onclick={start}>Transcribe</button>
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
  .hint { color: var(--muted); font-size: 0.9rem; }
  footer { color: var(--muted); font-size: 0.85rem; margin-top: 1rem; }
</style>
