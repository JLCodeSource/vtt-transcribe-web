<script lang="ts">
  import type { Segment } from '../lib/types';
  import { EXPORTERS, clockTime, view, type ExportFormat } from '../lib/format';

  interface Props { segments: Segment[]; basename: string; onreset: () => void; onspeakers?: () => void }
  const { segments: all, basename, onreset, onspeakers }: Props = $props();
  const hasTranslation = $derived(all.some((s) => s.translation != null));
  let showTranslated = $state(true);
  const segments = $derived(view(all, hasTranslation && showTranslated));
  let query = $state('');
  const shown = $derived(
    query ? segments.filter((s) => s.text.toLowerCase().includes(query.toLowerCase())) : segments
  );

  function download(fmt: ExportFormat) {
    const { fn, mime } = EXPORTERS[fmt];
    const url = URL.createObjectURL(new Blob([fn(segments)], { type: `${mime};charset=utf-8` }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${basename}.${fmt}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
</script>

<section class="viewer" aria-label="Transcript">
  <header>
    <h2>Transcript</h2>
    <div class="actions">
      {#each ['srt', 'vtt', 'txt', 'json'] as const as f (f)}
        <button type="button" onclick={() => download(f)}>{f.toUpperCase()}</button>
      {/each}
      {#if onspeakers}<button type="button" onclick={onspeakers}>Edit speakers</button>{/if}
      <button type="button" class="primary" onclick={onreset}>New transcription</button>
    </div>
  </header>
  {#if segments.length === 0}
    <p class="empty">No speech was detected in this file.</p>
  {:else}
    {#if hasTranslation}
      <label class="check"><input type="checkbox" bind:checked={showTranslated} /> Show / export the translation</label>
    {/if}
    <input type="search" placeholder="Search transcript…" aria-label="Search transcript" bind:value={query} />
    <p class="count">{shown.length} of {segments.length} segments</p>
    <ol>
      {#each shown as s (s.start + '-' + s.end + s.text + (s.speaker ?? ''))}
        <li><time>{clockTime(s.start)}</time><span>{#if s.speaker}<strong class="spk">{s.speaker}:</strong> {/if}{s.text}</span></li>
      {/each}
    </ol>
  {/if}
</section>

<style>
  .viewer { display: grid; gap: 0.75rem; }
  header { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: space-between; align-items: center; }
  h2 { margin: 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .count, .empty { margin: 0; color: var(--muted); font-size: 0.9rem; }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.4rem; }
  li { display: grid; grid-template-columns: 4.5rem 1fr; gap: 0.75rem; padding: 0.6rem 0.8rem; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
  .check { display: flex; gap: 0.5rem; font-size: 0.9rem; color: var(--muted); }
  .spk { color: var(--primary); }
  time { color: var(--primary); font-variant-numeric: tabular-nums; font-size: 0.9rem; }
</style>
