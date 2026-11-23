<script lang="ts">
  interface Props {
    files: File[];
    disabled?: boolean;
    onfiles: (f: File[]) => void;
  }
  let { files, disabled = false, onfiles }: Props = $props();
  let dragging = $state(false);
  let input: HTMLInputElement;

  function pick(list: FileList | null | undefined) {
    const picked = Array.from(list ?? []);
    if (picked.length) onfiles(picked);
  }
  const size = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`);
</script>

<div
  class="drop"
  class:dragging
  role="button"
  tabindex="0"
  aria-label="Choose audio or video files"
  ondragover={(e) => {
    e.preventDefault();
    dragging = true;
  }}
  ondragleave={() => (dragging = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragging = false;
    if (!disabled) pick(e.dataTransfer?.files);
  }}
  onclick={() => !disabled && input.click()}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), !disabled && input.click())}
>
  {#if files.length}
    {#each files as f (f.name + f.size + f.lastModified)}
      <p><strong>{f.name}</strong> · {size(f.size)}</p>
    {/each}
    <p class="sub">Click or drop to choose different files. They run one after another.</p>
  {:else}
    <p><strong>Drop audio or video files here</strong>, or click to browse</p>
    <p class="sub">
      mp3, wav, m4a, ogg, webm, mp4, mov — anything your browser can play. The file stays on your device.
    </p>
  {/if}
  <input
    bind:this={input}
    data-testid="file-input"
    type="file"
    multiple
    accept="audio/*,video/*,.m4a,.mp3,.wav,.ogg,.webm,.mp4,.mov"
    hidden
    onchange={(e) => pick(e.currentTarget.files)}
  />
</div>

<style>
  .drop {
    border: 2px dashed var(--border);
    border-radius: 12px;
    padding: 1.75rem 1rem;
    text-align: center;
    background: var(--surface);
    cursor: pointer;
  }
  .drop.dragging {
    border-color: var(--primary);
    background: var(--info-bg);
  }
  .drop p {
    margin: 0.2rem 0;
    overflow-wrap: anywhere;
  }
  .sub {
    color: var(--muted);
    font-size: 0.9rem;
  }
</style>
