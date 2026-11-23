<script lang="ts">
  import type { Retention } from '../lib/retention';
  import RetentionSelect from './RetentionSelect.svelte';
  import { notificationsSupported } from '../lib/notify';

  interface Props {
    retention: Retention;
    rememberKey: boolean;
    keepAudio: boolean;
    reviewFirst: boolean;
    onreviewfirst: (v: boolean) => void;
    notify: boolean;
    notifyDenied: boolean;
    onretention: (r: Retention) => void;
    onremember: (v: boolean) => void;
    onkeepaudio: (v: boolean) => void;
    onnotify: (v: boolean) => void;
    ondeleteall: () => void;
    deleted: boolean;
    usage: string;
    onclearmodels: () => void;
  }
  const p: Props = $props();
  let confirming = $state(false);
</script>

<section class="settings" aria-label="Settings">
  <h2>Settings</h2>
  <p class="hint">
    Everything here is stored only in this browser. There is no account and no server, so nothing syncs to other devices
    and no email is sent.
  </p>

  <fieldset>
    <legend>Keep results</legend>
    <span>Default for new results</span>
    <RetentionSelect label="Default retention" value={p.retention} onchange={p.onretention} />
    <p class="hint">
      Finished transcripts are saved in this browser (IndexedDB) so they survive a reload. Expired ones are deleted when
      the page loads and while it is open. You can override this for each result in Jobs.
    </p>
    <label class="check">
      <input type="checkbox" checked={p.keepAudio} onchange={(e) => p.onkeepaudio(e.currentTarget.checked)} />
      Also keep the audio file in this browser, so speaker samples can be played when you review later (uses a lot of space;
      deleted together with the result)
    </label>
  </fieldset>

  <fieldset>
    <legend>Speakers and translation</legend>
    <label class="check">
      <input type="checkbox" checked={p.reviewFirst} onchange={(e) => p.onreviewfirst(e.currentTarget.checked)} />
      Review the speakers before translating
    </label>
    <p class="hint">
      Off by default: transcription, speaker detection and translation all run first, and you review and name the
      speakers at the end. Turn this on to confirm the speakers before the translation runs.
    </p>
  </fieldset>

  <fieldset>
    <legend>OpenAI key</legend>
    <label class="check">
      <input type="checkbox" checked={p.rememberKey} onchange={(e) => p.onremember(e.currentTarget.checked)} />
      Remember my OpenAI key on this device
    </label>
    <p class="hint">
      The key is stored unencrypted in this browser's local storage and is only ever sent to api.openai.com. It is never
      sent to us or kept on a server. Anyone using this browser profile can read it. Turn this off to forget it.
    </p>
  </fieldset>

  <fieldset>
    <legend>Notifications</legend>
    <label class="check">
      <input
        type="checkbox"
        checked={p.notify}
        disabled={!notificationsSupported()}
        onchange={(e) => p.onnotify(e.currentTarget.checked)}
      />
      Tell me when a queued job finishes or fails while this tab is in the background
    </label>
    <p class="hint">
      Uses your browser's notifications (nothing is sent anywhere); the browser asks for permission only when you turn
      this on. The page must stay open.
      {#if !notificationsSupported()}Your browser does not support notifications.{/if}
      {#if p.notifyDenied}Notifications are blocked for this site in your browser settings.{/if}
    </p>
  </fieldset>

  <fieldset>
    <legend>Storage</legend>
    <p class="hint">
      {p.usage || 'Storage use is not available in this browser.'} This includes results, any kept audio and the downloaded
      on-device models.
    </p>
    <button type="button" onclick={p.onclearmodels}>Clear downloaded models (keeps your results)</button>
  </fieldset>

  <fieldset>
    <legend>Your data</legend>
    {#if confirming}
      <p>
        Delete every saved result, any kept audio, your saved key, your settings and the cached on-device models from
        this browser? This cannot be undone.
      </p>
      <div class="row">
        <button
          type="button"
          class="danger"
          onclick={() => {
            confirming = false;
            p.ondeleteall();
          }}
        >
          Yes, delete everything
        </button>
        <button type="button" onclick={() => (confirming = false)}>Cancel</button>
      </div>
    {:else}
      <button type="button" class="danger" onclick={() => (confirming = true)}>Delete all my data</button>
    {/if}
    {#if p.deleted}<p class="hint" role="status">All data stored by this app in this browser has been deleted.</p>{/if}
  </fieldset>
</section>

<style>
  .settings {
    display: grid;
    gap: 1rem;
  }
  h2 {
    margin: 0;
  }
  fieldset {
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 0.8rem 1rem;
    display: grid;
    gap: 0.5rem;
    background: var(--surface);
  }
  legend {
    font-weight: 600;
    padding: 0 0.3rem;
  }
  .hint {
    margin: 0;
    color: var(--muted);
    font-size: 0.9rem;
  }
  .check {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }
  .danger {
    border-color: var(--err);
    color: var(--err);
  }
</style>
