<script lang="ts">
  import TranscriptViewer from './TranscriptViewer.svelte';
  import SpeakerReview from './SpeakerReview.svelte';
  import ProgressView from './ProgressView.svelte';
  import type { SpeakerNames, Turn } from '../lib/speakers';
  import { activeVersion } from '../lib/versions';
  import type { StoredJob } from '../lib/store';
  import type { LiveItem } from '../lib/service';
  import { describeRetention } from '../lib/retention';

  interface Props {
    job: StoredJob;
    /** a translation queued or running for this job */
    translating?: LiveItem;
    loadAudio: () => Promise<Blob | undefined>;
    onfinish: (turns: Turn[] | null, names: SpeakerNames) => Promise<void>;
    onaddlanguage: (
      lang: string,
      engine: 'openai' | 'local',
      source?: string,
    ) => Promise<'queued' | 'needs-source' | 'missing'>;
    /** a failed translation for this result, to show instead of failing silently */
    translateError?: LiveItem;
    ondismisserror: (id: string) => void;
    onrecluster: (count: number) => void;
    onsetversion: (id: string | null) => void;
    onrenameversion: (id: string, name: string) => void;
    ondeleteversion: (id: string) => void;
    ondownload: () => void;
    oncancel: (id: string) => void;
    onback: () => void;
    onnew: () => void;
  }
  const p: Props = $props();
  // svelte-ignore state_referenced_locally
  let reviewing = $state(p.job.awaitingReview);
  // language shown (null = original); starts on the newest translation
  // svelte-ignore state_referenced_locally
  let lang = $state<string | null>(
    Object.values(p.job.translations)
      .sort((a, b) => a.createdAt - b.createdAt)
      .at(-1)?.lang ?? null,
  );
  let audio = $state<Blob | undefined>();
  let audioReady = $state(false);
  let busy = $state(false);
  async function finish(t: Turn[] | null, n: SpeakerNames) {
    reviewing = false;
    busy = true;
    try {
      await p.onfinish(t, n);
    } finally {
      busy = false;
    }
  }
  $effect(() => {
    void p.loadAudio().then((a) => ((audio = a), (audioReady = true)));
  });

  const version = $derived(activeVersion(p.job));
  const basename = $derived(p.job.name.replace(/\.[^.]+$/, '') || 'transcript');
</script>

{#if p.translating && (p.job.awaitingReview || !Object.keys(p.job.translations).length)}
  <ProgressView
    progress={p.translating.progress ?? {
      phase: 'transcribe',
      fraction: null,
      message: p.translating.status === 'queued' ? 'Translation is waiting its turn…' : 'Translating…',
    }}
    oncancel={() => p.oncancel(p.translating!.id)}
  />
{:else if reviewing && version && audioReady}
  <SpeakerReview
    turns={version.turns}
    names={version.names}
    segments={p.job.segments}
    {audio}
    onconfirm={finish}
    onskip={() => finish(null, {})}
  />
{:else if busy}
  <p class="ranon" role="status">Saving…</p>
{:else if !reviewing}
  {#if p.job.warning}<p class="warn" role="alert">{p.job.warning}</p>{/if}
  {#if p.job.ranOn}<p class="ranon" data-testid="ran-on">Transcribed {p.job.ranOn}.</p>{/if}
  <p class="ranon">
    {describeRetention(p.job)}.
    <a
      href="#jobs"
      onclick={(e) => {
        e.preventDefault();
        p.onback();
      }}
    >
      Change in Jobs
    </a>
  </p>
  {#if p.translateError}
    <p class="warn" role="alert">
      Translation failed: {p.translateError.error ?? 'something went wrong.'}
      <button type="button" onclick={() => p.ondismisserror(p.translateError!.id)}>Dismiss</button>
    </p>
  {/if}
  {#if p.translating}
    <ProgressView
      progress={p.translating.progress ?? {
        phase: 'transcribe',
        fraction: null,
        message: p.translating.status === 'queued' ? 'Translation is waiting its turn…' : 'Translating…',
      }}
      oncancel={() => p.oncancel(p.translating!.id)}
    />
  {/if}
  <TranscriptViewer
    job={p.job}
    bind:lang
    {basename}
    onreset={p.onnew}
    onback={p.onback}
    ondownload={p.ondownload}
    onspeakers={() => (reviewing = true)}
    onaddlanguage={p.onaddlanguage}
    onrecluster={p.onrecluster}
    onsetversion={p.onsetversion}
    onrenameversion={p.onrenameversion}
    ondeleteversion={p.ondeleteversion}
  />
{/if}

<style>
  .ranon {
    color: var(--muted);
    font-size: 0.9rem;
    margin: 0 0 0.5rem;
  }
  .warn {
    color: var(--err);
    margin: 0;
  }
</style>
