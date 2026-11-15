<script lang="ts">
  import { LOCAL_MODELS, hasWebGpu } from '../lib/local';
  import { LANGUAGES } from '../lib/languages';
  import { DIARIZE_DOWNLOAD } from '../lib/diarize';

  export type EngineChoice = 'openai' | 'local';
  interface Props {
    engine: EngineChoice;
    apiKey: string;
    remember: boolean;
    model: string;
    language: string;
    target: string;
    diarize: boolean;
    speakerCount: string;
  }
  let {
    engine = $bindable(),
    apiKey = $bindable(),
    remember = $bindable(),
    model = $bindable(),
    language = $bindable(),
    target = $bindable(),
    diarize = $bindable(),
    speakerCount = $bindable(),
  }: Props = $props();

  const gpu = hasWebGpu();
  const picked = $derived(LOCAL_MODELS.find((m) => m.id === model) ?? LOCAL_MODELS[1]);
  const LANGS: Array<[string, string]> = [['auto', 'Detect automatically'], ...LANGUAGES];
</script>

<fieldset class="picker">
  <legend>How should the audio be transcribed?</legend>

  <div class="card active default">
    <span>
      <strong>On this device (default) — no key, no upload</strong>
      <small>Whisper runs inside your browser. Your audio never leaves your computer. Free, but slower and less accurate than OpenAI.</small>
    </span>
  </div>

  {#if engine === 'local'}
    <div class="panel">
      <label for="model">Model size</label>
      <select id="model" bind:value={model}>
        {#each LOCAL_MODELS as m (m.id)}
          <option value={m.id}>{m.label} · {m.size}</option>
        {/each}
      </select>
      <p class="hint">
        {picked.note} The model downloads once from Hugging Face and is cached by your browser.
        {#if gpu}
          Your browser supports WebGPU, so the GPU will be used (faster, but it downloads larger weights: {picked.gpuSize}).
        {:else}
          Your browser has no WebGPU, so this runs on the CPU via WebAssembly: expect it to be several times slower than
          real time on long recordings.
        {/if}
      </p>
    </div>
  {/if}

  <label class="check optin">
    <input
      type="checkbox"
      checked={engine === 'openai'}
      onchange={(e) => (engine = e.currentTarget.checked ? 'openai' : 'local')}
    />
    <span>
      <strong>Use OpenAI instead (needs your own API key)</strong>
      <small>
        Faster and more accurate. Opting in means your audio is uploaded from this browser to OpenAI and billed to your
        OpenAI account. Off by default.
      </small>
    </span>
  </label>

  {#if engine === 'openai'}
    <div class="panel">
      <label for="key">Your OpenAI API key</label>
      <input
        id="key"
        type="password"
        autocomplete="off"
        spellcheck="false"
        placeholder="sk-…"
        bind:value={apiKey}
      />
      <p class="hint">
        🔒 Your key never leaves your browser except to authenticate with api.openai.com. We have no server; nothing is
        sent to us.
      </p>
      <label class="check">
        <input type="checkbox" bind:checked={remember} />
        Remember the key on this device (stored unencrypted in this browser's local storage)
      </label>
    </div>
  {/if}

  <label for="lang" class="lang">Spoken language</label>
  <select id="lang" bind:value={language}>
    {#each LANGS as [code, name] (code)}<option value={code}>{name}</option>{/each}
  </select>
  {#if engine === 'local' && language === 'auto'}
    <p class="hint">The language is detected from the first 30 seconds of audio. Pick it yourself if the recording starts with silence or music.</p>
  {/if}

  <label for="target" class="lang">Translate the transcript into</label>
  <select id="target" bind:value={target}>
    <option value="">Don't translate</option>
    {#each LANGUAGES as [code, name] (code)}<option value={code}>{name}</option>{/each}
  </select>
  {#if target && engine === 'local'}
    <p class="hint">
      On-device translation uses small models (≈ 75 MB per language pair) and is rougher than OpenAI. Languages other
      than English are translated via English. Set the spoken language above.
    </p>
  {/if}

  <label class="check lang">
    <input type="checkbox" bind:checked={diarize} />
    Identify the speakers (runs on this device; {DIARIZE_DOWNLOAD})
  </label>
  {#if diarize}
    <div class="panel">
      <label for="spk">How many speakers?</label>
      <select id="spk" bind:value={speakerCount}>
        <option value="auto">Detect automatically</option>
        {#each [1, 2, 3, 4, 5, 6] as n (n)}<option value={String(n)}>{n}</option>{/each}
      </select>
      <p class="hint">You can merge, split and name speakers afterwards.</p>
    </div>
  {/if}
</fieldset>

<style>
  fieldset { border: 0; padding: 0; margin: 0 0 1.25rem; display: grid; gap: 0.6rem; }
  legend { font-weight: 600; margin-bottom: 0.5rem; padding: 0; }
  .card {
    display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.85rem 1rem;
    border: 1px solid var(--border); border-radius: 10px; background: var(--surface); cursor: pointer;
  }
  .card.active { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
  .default { cursor: default; }
  .optin { align-items: flex-start; padding: 0.6rem 0.25rem; color: var(--text); }
  .optin small { display: block; color: var(--muted); }
  .card small { display: block; color: var(--muted); }
  .panel { padding: 0.25rem 0.25rem 0.5rem 1rem; display: grid; gap: 0.4rem; }
  .hint { margin: 0; color: var(--muted); font-size: 0.9rem; }
  .check { display: flex; gap: 0.5rem; font-size: 0.9rem; color: var(--muted); }
  .lang { margin-top: 0.5rem; }
</style>
