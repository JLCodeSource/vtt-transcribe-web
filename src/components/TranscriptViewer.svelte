<script lang="ts">
  import { EXPORTERS, clockTime, type ExportFormat } from '../lib/format';
  import { LANGUAGES, languageName } from '../lib/languages';
  import { activeVersion, langLabel, render } from '../lib/versions';
  import type { StoredJob } from '../lib/store';

  interface Props {
    job: StoredJob;
    /** language shown: null = original. Owned by the parent so it survives opening the speaker editor. */
    lang: string | null;
    basename: string;
    onreset: () => void;
    onspeakers?: () => void;
    ondownload?: () => void;
    onback?: () => void;
    /** queue a translation of the original into `lang` (adds it, or replaces just that language) */
    onaddlanguage: (lang: string, engine: 'openai' | 'local') => void;
    onrecluster: (count: number) => void;
    onsetversion: (id: string | null) => void;
    onrenameversion: (id: string, name: string) => void;
    ondeleteversion: (id: string) => void;
  }
  let { lang = $bindable(), ...p }: Props = $props();
  const job = $derived(p.job);

  const langs = $derived(Object.values(job.translations).sort((a, b) => a.createdAt - b.createdAt));
  const origName = $derived(job.sourceLang ? `Original (${languageName(job.sourceLang)})` : 'Original');
  let side = $state(false);
  // a newly finished translation is shown right away
  // svelte-ignore state_referenced_locally
  let seen = $state(Object.keys(p.job.translations).length);
  $effect(() => {
    const n = langs.length;
    if (n > seen) lang = langs[n - 1].lang;
    seen = n;
    if (lang && !job.translations[lang]) lang = null;
  });

  const version = $derived(activeVersion(job));
  const segments = $derived(render(job, { lang, bilingual: side && !!lang }));
  let query = $state('');
  const shown = $derived(
    query ? segments.filter((s) => (s.text + ' ' + (s.alt ?? '')).toLowerCase().includes(query.toLowerCase())) : segments
  );

  // adding a language
  let adding = $state(false);
  let newLang = $state('');
  // svelte-ignore state_referenced_locally
  let newEngine = $state<'openai' | 'local'>(p.job.engine);
  let confirmReplace = $state(false);
  const exists = $derived(!!newLang && !!job.translations[newLang]);
  function pickLang(v: string) {
    if (v === '__add') { adding = true; return; }
    lang = v === '' ? null : v;
  }
  function startTranslate() {
    if (!newLang) return;
    if (exists && !confirmReplace) { confirmReplace = true; return; }
    p.onaddlanguage(newLang, newEngine);
    adding = false;
    confirmReplace = false;
    newLang = '';
  }

  // speaker versions
  let clusterN = $state(2);
  let renaming = $state(false);
  let renameTo = $state('');

  // export: "view" follows what is on screen
  let exLang = $state('view');
  let exVer = $state('view');
  let exBoth = $state(false);
  function download(fmt: ExportFormat) {
    const l = exLang === 'view' ? lang : exLang === 'orig' ? null : exLang;
    const v = exVer === 'view' ? job.activeDiarization : exVer === 'none' ? null : exVer;
    const out = render(job, { lang: l, version: v, bilingual: exBoth && !!l });
    const { fn, mime } = EXPORTERS[fmt];
    const url = URL.createObjectURL(new Blob([fn(out)], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    const suffix = (l ? `.${l}` : '') + (exBoth && l ? '.bilingual' : '');
    a.download = `${p.basename}${suffix}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    p.ondownload?.();
  }
</script>

<section class="viewer" aria-label="Transcript">
  <header>
    <h2>Transcript</h2>
    <div class="actions">
      {#if p.onspeakers && version}<button type="button" onclick={p.onspeakers}>Edit speakers</button>{/if}
      {#if p.onback}<button type="button" onclick={p.onback}>Back to jobs</button>{/if}
      <button type="button" class="primary" onclick={p.onreset}>New transcription</button>
    </div>
  </header>

  <div class="bar">
    <label>Language
      <select aria-label="Language" value={lang ?? ''} onchange={(e) => pickLang(e.currentTarget.value)}>
        <option value="">{origName}</option>
        {#each langs as t (t.lang)}<option value={t.lang}>{langLabel(t.lang)}</option>{/each}
        <option value="__add">Add language…</option>
      </select>
    </label>
    {#if lang}
      <label class="check"><input type="checkbox" bind:checked={side} /> Original and translation side by side</label>
    {/if}
  </div>

  {#if adding}
    <div class="panel" role="group" aria-label="Add language">
      <label>Translate into
        <select aria-label="Translate into" bind:value={newLang} onchange={() => (confirmReplace = false)}>
          <option value="">Choose…</option>
          {#each LANGUAGES.filter(([c]) => c !== job.sourceLang) as [c, n] (c)}
            <option value={c}>{n}{job.translations[c] ? ' (already have)' : ''}</option>
          {/each}
        </select>
      </label>
      <label>With
        <select aria-label="Translation engine" bind:value={newEngine}>
          <option value="local">On this device</option>
          <option value="openai">OpenAI (needs your key)</option>
        </select>
      </label>
      {#if confirmReplace}
        <span class="hint">Replace the existing {languageName(newLang)} translation? Other languages are kept.</span>
      {/if}
      <button type="button" class="primary" disabled={!newLang} onclick={startTranslate}>{confirmReplace ? 'Replace it' : exists ? 'Re-translate' : 'Translate'}</button>
      <button type="button" onclick={() => ((adding = false), (confirmReplace = false))}>Cancel</button>
    </div>
  {/if}

  {#if job.diarizations.length}
    <div class="bar" role="group" aria-label="Speaker versions">
      <label>Speakers
        <select aria-label="Speaker version" value={job.activeDiarization ?? ''} onchange={(e) => p.onsetversion(e.currentTarget.value || null)}>
          <option value="">No speaker labels</option>
          {#each job.diarizations as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
        </select>
      </label>
      {#if version}
        {#if renaming}
          <input type="text" aria-label="New name for this version" bind:value={renameTo} />
          <button type="button" onclick={() => { p.onrenameversion(version.id, renameTo); renaming = false; }}>Save name</button>
        {:else}
          <button type="button" onclick={() => { renameTo = version.name; renaming = true; }}>Rename version</button>
        {/if}
        <button type="button" disabled={job.diarizations.length < 2} title={job.diarizations.length < 2 ? 'The last version cannot be deleted' : ''} onclick={() => p.ondeleteversion(version.id)}>Delete version</button>
      {/if}
      <label class="n">Re-run with
        <input type="number" min="1" max="20" aria-label="Number of speakers" bind:value={clusterN} />
        speakers</label>
      <button type="button" onclick={() => p.onrecluster(clusterN)}>Re-run with {clusterN} {clusterN === 1 ? 'speaker' : 'speakers'}</button>
    </div>
  {/if}

  <details class="export">
    <summary>Export options</summary>
    <div class="bar">
      <label>Language
        <select aria-label="Export language" bind:value={exLang}>
          <option value="view">As shown</option>
          <option value="orig">{origName}</option>
          {#each langs as t (t.lang)}<option value={t.lang}>{langLabel(t.lang)}</option>{/each}
        </select>
      </label>
      {#if job.diarizations.length}
        <label>Speakers
          <select aria-label="Export speaker version" bind:value={exVer}>
            <option value="view">As shown</option>
            <option value="none">No speaker labels</option>
            {#each job.diarizations as v (v.id)}<option value={v.id}>{v.name}</option>{/each}
          </select>
        </label>
      {/if}
      {#if langs.length}
        <label class="check"><input type="checkbox" bind:checked={exBoth} /> Bilingual (original and translation)</label>
      {/if}
    </div>
  </details>
  <div class="actions" role="group" aria-label="Download">
    {#each ['srt', 'vtt', 'txt', 'json'] as const as f (f)}
      <button type="button" onclick={() => download(f)}>{f.toUpperCase()}</button>
    {/each}
  </div>

  {#if segments.length === 0}
    <p class="empty">No speech was detected in this file.</p>
  {:else}
    <input type="search" placeholder="Search transcript…" aria-label="Search transcript" bind:value={query} />
    <p class="count">{shown.length} of {segments.length} segments</p>
    <ol>
      {#each shown as s (s.start + '-' + s.end + s.text + (s.speaker ?? ''))}
        <li class:side={s.alt != null}>
          <time>{clockTime(s.start)}</time>
          <span>{#if s.speaker}<strong class="spk">{s.speaker}:</strong> {/if}{s.text}</span>
          {#if s.alt != null}<span class="alt" lang={lang ?? undefined}>{s.alt}</span>{/if}
        </li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .viewer { display: grid; gap: 0.75rem; }
  header { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; align-items: center; }
  h2 { margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .bar { display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; align-items: center; }
  .bar label { display: inline-flex; gap: 0.4rem; align-items: center; }
  .n input { width: 4.5rem; }
  .panel { display: flex; flex-wrap: wrap; gap: 0.5rem 0.75rem; align-items: center; padding: 0.7rem 0.9rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; }
  .hint { color: var(--muted); font-size: 0.9rem; }
  .export summary { cursor: pointer; color: var(--muted); }
  .count, .empty { margin: 0; color: var(--muted); font-size: 0.9rem; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
  li { display: grid; grid-template-columns: 4.5rem 1fr; gap: 0.75rem; padding: 0.6rem 0.8rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  li.side { grid-template-columns: 4.5rem 1fr 1fr; }
  .alt { color: var(--muted); }
  @media (max-width: 560px) {
    li.side { grid-template-columns: 4.5rem 1fr; }
    li.side .alt { grid-column: 2; }
  }
  .check { display: flex; gap: 0.5rem; font-size: 0.9rem; color: var(--muted); }
  .spk { color: var(--primary); }
  time { color: var(--primary); font-variant-numeric: tabular-nums; font-size: 0.9rem; }
</style>
