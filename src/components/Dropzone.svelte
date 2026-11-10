<script lang="ts">
  interface Props { file: File | null; disabled?: boolean; onfile: (f: File) => void }
  let { file, disabled = false, onfile }: Props = $props();
  let dragging = $state(false);
  let input: HTMLInputElement;

  function pick(list: FileList | null | undefined) {
    const f = list?.[0];
    if (f) onfile(f);
  }
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);
</script>

<div
  class="drop"
  class:dragging
  role="button"
  tabindex="0"
  aria-label="Choose an audio or video file"
  ondragover={(e) => { e.preventDefault(); dragging = true; }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => { e.preventDefault(); dragging = false; if (!disabled) pick(e.dataTransfer?.files); }}
  onclick={() => !disabled && input.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !disabled && input.click())}
>
  {#if file}
    <p><strong>{file.name}</strong> · {size(file.size)}</p>
    <p class="sub">Click or drop to choose a different file</p>
  {:else}
    <p><strong>Drop an audio or video file here</strong>, or click to browse</p>
    <p class="sub">mp3, wav, m4a, ogg, webm, mp4, mov — anything your browser can play. The file stays on your device.</p>
  {/if}
  <input bind:this={input} data-testid="file-input" type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4,.mov" hidden onchange={(e) => pick(e.currentTarget.files)} />
</div>

<style>
  .drop {
    border: 2px dashed var(--border); border-radius: 12px; padding: 1.75rem 1rem; text-align: center;
    background: var(--surface); cursor: pointer;
  }
  .drop.dragging { border-color: var(--primary); background: var(--info-bg); }
  .drop p { margin: 0.2rem 0; overflow-wrap: anywhere; }
  .sub { color: var(--muted); font-size: 0.9rem; }
</style>
