<script lang="ts">
  import type { Retention } from '../lib/retention';
  interface Props { value: Retention; label: string; onchange: (r: Retention) => void }
  const { value, label, onchange }: Props = $props();
  const DAYS = [1, 3, 7, 14, 30, 90];
  const enc = (r: Retention) => (r.mode === 'days' ? `days:${r.days}` : r.mode);
  const options = $derived(value.mode === 'days' && !DAYS.includes(value.days) ? [...DAYS, value.days].sort((a, b) => a - b) : DAYS);
  function change(v: string) {
    if (v === 'keep' || v === 'afterDownload') onchange({ mode: v });
    else onchange({ mode: 'days', days: Number(v.split(':')[1]) });
  }
</script>

<select aria-label={label} value={enc(value)} onchange={(e) => change(e.currentTarget.value)}>
  <option value="keep">Keep until I delete it</option>
  <option value="afterDownload">Delete after I download it</option>
  {#each options as d (d)}<option value="days:{d}">Hold {d} {d === 1 ? 'day' : 'days'}</option>{/each}
</select>
