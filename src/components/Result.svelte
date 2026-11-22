<script lang="ts">
  import TranscriptViewer from './TranscriptViewer.svelte';
  import SpeakerReview from './SpeakerReview.svelte';
  import ProgressView from './ProgressView.svelte';
  import { labelSegments, type SpeakerNames, type Turn } from '../lib/speakers';
  import type { StoredJob } from '../lib/store';
  import type { LiveItem } from '../lib/service';
  import { describeRetention } from '../lib/retention';

  interface Props {
    job: StoredJob;
    /** a translation queued or running for this job */
    translating?: LiveItem;
    loadAudio: () => Promise<Blob | undefined>;
    onfinish: (turns: Turn[] | null, names: SpeakerNames) => Promise<void>;
    ondownload: () => void;
    oncancel: (id: string) => void;
    onback: () => void;
    onnew: () => void;
  }
  const p: Props = $props();
  // svelte-ignore state_referenced_locally
  let reviewing = $state(p.job.awaitingReview);
  let audio = $state<Blob | undefined>();
  let audioReady = $state(false);
  let busy = $state(false);
  async function finish(t: Turn[] | null, n: SpeakerNames) {
    reviewing = false;
    busy = true;
    try { await p.onfinish(t, n); } finally { busy = false; }
  }
  $effect(() => {
    void p.loadAudio().then((a) => ((audio = a), (audioReady = true)));
  });

  const segments = $derived(p.job.turns ? labelSegments(p.job.segments, p.job.turns, p.job.names) : p.job.segments);
  const basename = $derived(p.job.name.replace(/\.[^.]+$/, '') || 'transcript');
</script>

{#if p.translating}
  <ProgressView
    progress={p.translating.progress ?? { phase: 'transcribe', fraction: null, message: p.translating.status === 'queued' ? 'Translation is waiting its turn…' : 'Translating…' }}
    oncancel={() => p.oncancel(p.translating!.id)}
  />
{:else if reviewing && p.job.turns && audioReady}
  <SpeakerReview
    turns={p.job.turns}
    names={p.job.names}
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
  <p class="ranon">{describeRetention(p.job)}. <a href="#jobs" onclick={(e) => { e.preventDefault(); p.onback(); }}>Change in Jobs</a></p>
  <TranscriptViewer
    {segments}
    {basename}
    onreset={p.onnew}
    onback={p.onback}
    ondownload={p.ondownload}
    onspeakers={p.job.turns ? () => (reviewing = true) : undefined}
  />
{/if}

<style>
  .ranon { color: var(--muted); font-size: 0.9rem; margin: 0 0 0.5rem; }
  .warn { color: var(--err); margin: 0; }
</style>
