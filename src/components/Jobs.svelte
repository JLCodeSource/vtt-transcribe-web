<script lang="ts">
  import type { LiveItem } from '../lib/service';
  import type { StoredJob } from '../lib/store';
  import { describeRetention, type Retention } from '../lib/retention';
  import RetentionSelect from './RetentionSelect.svelte';

  interface Props {
    live: LiveItem[];
    position: (id: string) => number;
    jobs: StoredJob[];
    unsaved: (id: string) => boolean;
    storageError: string;
    onnew: () => void;
    oncancel: (id: string) => void;
    ondismiss: (id: string) => void;
    onopen: (id: string) => void;
    ondelete: (id: string) => void;
    onretention: (id: string, r: Retention) => void;
    onclearerror: () => void;
  }
  const p: Props = $props();
  const pct = (f: number | null | undefined) => (f == null ? null : Math.round(f * 100));
  const label = (i: LiveItem) => (i.input.kind === 'translate' ? `${i.name} (translation)` : i.name);
</script>

<section class="jobs" aria-label="Jobs">
  <header>
    <h2>Jobs</h2>
    <button type="button" class="primary" onclick={p.onnew}>Add files</button>
  </header>
  {#if p.storageError}
    <div class="warn" role="alert">{p.storageError} <button type="button" onclick={p.onclearerror}>Dismiss</button></div>
  {/if}

  {#if p.live.length === 0 && p.jobs.length === 0}
    <p class="empty">Nothing here yet. Add files and they will run one at a time, in order. Finished transcripts are kept in this browser only.</p>
  {/if}

  {#if p.live.length}
    <ul data-testid="live-jobs">
      {#each p.live as i (i.id)}
        <li data-status={i.status}>
          <div class="row">
            <strong>{label(i)}</strong>
            <span class="status">
              {#if i.status === 'queued'}Waiting · position {p.position(i.id)}
              {:else if i.status === 'running'}{i.step || 'Working'}
              {:else if i.status === 'failed'}Failed
              {:else if i.status === 'cancelled'}Cancelled
              {:else}Done{/if}
            </span>
          </div>
          {#if i.status === 'running'}
            <p class="msg">{i.progress?.message ?? ''}{#if pct(i.progress?.fraction) != null} · {pct(i.progress?.fraction)}%{/if}</p>
            <progress max="100" value={pct(i.progress?.fraction) ?? undefined} aria-label="Progress for {i.name}"></progress>
          {/if}
          {#if i.error}<p class="err" role="alert">{i.error}</p>{/if}
          <div class="row actions">
            {#if i.status === 'queued' || i.status === 'running'}
              <button type="button" onclick={() => p.oncancel(i.id)}>Cancel</button>
            {:else}
              <button type="button" onclick={() => p.ondismiss(i.id)}>Dismiss</button>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  {/if}

  {#if p.jobs.length}
    <h3>Saved in this browser</h3>
    <ul data-testid="saved-jobs">
      {#each p.jobs as j (j.id)}
        <li data-job={j.id}>
          <div class="row">
            <strong>{j.name}</strong>
            <span class="status">{j.awaitingReview ? 'Speakers to review' : 'Ready'}</span>
          </div>
          <p class="msg">
            Finished {new Date(j.completedAt).toLocaleString()} · {describeRetention(j)}
            {#if p.unsaved(j.id)} · <strong>not saved: only in this tab</strong>{/if}
          </p>
          {#if j.warning}<p class="err">{j.warning}</p>{/if}
          <div class="row actions">
            <button type="button" class="primary" onclick={() => p.onopen(j.id)}>{j.awaitingReview ? 'Review speakers' : 'Open'}</button>
            <RetentionSelect label="Keep {j.name}" value={j.retention} onchange={(r) => p.onretention(j.id, r)} />
            <button type="button" onclick={() => p.ondelete(j.id)} aria-label="Delete {j.name}">Delete</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .jobs { display: grid; gap: 0.75rem; }
  header { display: flex; justify-content: space-between; align-items: center; }
  h2, h3 { margin: 0; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6rem; }
  li { padding: 0.8rem 1rem; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; display: grid; gap: 0.4rem; }
  .row { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: space-between; }
  .row.actions { justify-content: flex-start; }
  .status, .msg, .empty { color: var(--muted); font-size: 0.9rem; margin: 0; }
  .err { color: var(--err); margin: 0; }
  .warn { background: var(--err-bg); color: var(--err); border: 1px solid var(--err); border-radius: 8px; padding: 0.6rem 0.9rem; }
  progress { width: 100%; height: 10px; accent-color: var(--primary); }
  strong { overflow-wrap: anywhere; }
</style>
