<script lang="ts">
  import type { Segment } from '../lib/types';
  import { clockTime } from '../lib/format';
  import {
    defaultName,
    mergeSpeakers,
    speakerAt,
    speakerIds,
    speakerSummary,
    splitSpeaker,
    type SpeakerNames,
    type Turn,
  } from '../lib/speakers';

  interface Props {
    turns: Turn[];
    names: SpeakerNames;
    segments: Segment[];
    /** audio for sample playback; absent when it was not kept (see Settings) */
    audio?: Blob;
    onconfirm: (turns: Turn[], names: SpeakerNames) => void;
    onskip: () => void;
  }
  const props: Props = $props();
  // svelte-ignore state_referenced_locally
  let turns = $state(props.turns);
  // svelte-ignore state_referenced_locally
  let names = $state<SpeakerNames>({ ...props.names });
  let note = $state('');
  let mergeInto = $state<Record<number, string>>({});

  const ids = $derived(speakerIds(turns));
  // svelte-ignore state_referenced_locally
  const url = props.audio ? URL.createObjectURL(props.audio) : '';
  let audio = $state<HTMLAudioElement>();
  let stopAt = 0;
  $effect(() => () => {
    if (url) URL.revokeObjectURL(url);
  });

  function play(start: number, end: number) {
    if (!audio) return;
    stopAt = end;
    audio.currentTime = start;
    void audio.play().catch(() => (note = 'Your browser blocked audio playback.'));
  }
  const ontime = () => {
    if (audio && stopAt && audio.currentTime >= stopAt) {
      audio.pause();
      stopAt = 0;
    }
  };

  function sampleText(id: number): string {
    const seg = props.segments.find((s) => speakerAt(turns, s.start, s.end) === id && s.text.trim());
    return seg ? `“${seg.text.trim()}”` : '';
  }

  function merge(from: number) {
    const into = Number(mergeInto[from]);
    if (Number.isNaN(into)) return;
    turns = mergeSpeakers(turns, from, into);
    note = `Merged ${names[from] || defaultName(from)} into ${names[into] || defaultName(into)}.`;
    mergeInto[from] = '';
  }
  function split(id: number) {
    const r = splitSpeaker(turns, id);
    if (!r) {
      note = `${names[id] || defaultName(id)} only has one stretch of speech, so there is nothing to split.`;
      return;
    }
    turns = r.turns;
    note = `Split ${names[id] || defaultName(id)} in two. Listen to both and merge back if it was wrong.`;
  }
  const confirm = () => props.onconfirm(turns, names);
</script>

<section class="review" aria-label="Review speakers">
  <h2>Who is who?</h2>
  <p class="hint">
    Found {ids.length}
    {ids.length === 1 ? 'speaker' : 'speakers'}. Listen to a sample, give each a name, merge voices that are really the
    same person, or split one that is two people.
  </p>
  <!-- svelte-ignore a11y_media_has_caption -->
  {#if url}
    <audio bind:this={audio} src={url} ontimeupdate={ontime} preload="metadata"></audio>
  {:else}
    <p class="hint">
      Sample playback is unavailable because the audio was not kept in this browser (you can change that in Settings).
      You can still rename, merge and split using the text samples.
    </p>
  {/if}
  {#if note}<p class="note" role="status">{note}</p>{/if}

  <ul>
    {#each ids as id (id)}
      {@const sum = speakerSummary(turns, id)}
      <li data-speaker={id}>
        <div class="row">
          <input
            type="text"
            aria-label="Name for {defaultName(id)}"
            placeholder={defaultName(id)}
            bind:value={names[id]}
          />
          <span class="meta">{clockTime(sum.seconds)} speaking</span>
        </div>
        {#if sampleText(id)}<p class="quote">{sampleText(id)}</p>{/if}
        <div class="row actions">
          {#each url ? sum.samples : [] as s, i (i)}
            <button
              type="button"
              onclick={() => play(s.start, s.end)}
              aria-label="Play sample {i + 1} of {names[id] || defaultName(id)}"
            >
              ▶ {clockTime(s.start)}
            </button>
          {/each}
          <button type="button" onclick={() => split(id)}>Split</button>
          {#if ids.length > 1}
            <select aria-label="Merge {names[id] || defaultName(id)} into" bind:value={mergeInto[id]}>
              <option value="">Merge into…</option>
              {#each ids.filter((o) => o !== id) as o (o)}
                <option value={String(o)}>{names[o] || defaultName(o)}</option>
              {/each}
            </select>
            <button type="button" disabled={!mergeInto[id]?.length} onclick={() => merge(id)}>Merge</button>
          {/if}
        </div>
      </li>
    {/each}
  </ul>

  <div class="go">
    <button type="button" class="primary" onclick={confirm}>Looks good</button>
    <button type="button" onclick={props.onskip}>Skip speaker labels</button>
  </div>
</section>

<style>
  .review {
    display: grid;
    gap: 0.75rem;
  }
  h2 {
    margin: 0;
  }
  .hint,
  .note {
    margin: 0;
    color: var(--muted);
  }
  .note {
    color: var(--primary);
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }
  li {
    padding: 0.8rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    display: grid;
    gap: 0.5rem;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .row input {
    flex: 1 1 12rem;
  }
  .meta {
    color: var(--muted);
    font-size: 0.9rem;
  }
  .quote {
    margin: 0;
    font-style: italic;
    color: var(--muted);
  }
  .go {
    display: flex;
    gap: 0.75rem;
  }
</style>
