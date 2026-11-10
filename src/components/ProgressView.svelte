<script lang="ts">
  import type { Progress } from '../lib/types';
  interface Props { progress: Progress; oncancel: () => void }
  const { progress, oncancel }: Props = $props();
  const pct = $derived(progress.fraction == null ? null : Math.round(progress.fraction * 100));
</script>

<div class="progress" role="status" aria-live="polite">
  <p>{progress.message}</p>
  <progress max="100" value={pct ?? undefined} aria-label="Progress"></progress>
  <button type="button" onclick={oncancel}>Cancel</button>
</div>

<style>
  .progress { display: grid; gap: 0.75rem; padding: 1.25rem; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
  p { margin: 0; }
  progress { width: 100%; height: 12px; accent-color: var(--primary); }
</style>
