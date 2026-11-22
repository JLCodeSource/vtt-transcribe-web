<script lang="ts">
  import { onMount } from 'svelte';
  import EnginePicker, { type EngineChoice } from './components/EnginePicker.svelte';
  import Dropzone from './components/Dropzone.svelte';
  import Jobs from './components/Jobs.svelte';
  import Settings from './components/Settings.svelte';
  import Result from './components/Result.svelte';
  import { JobStore, type StoredJob } from './lib/store';
  import { JobService, type LiveItem } from './lib/service';
  import { runTask, type JobOptions } from './lib/pipeline';
  import type { Retention } from './lib/retention';
  import type { SpeakerNames, Turn } from './lib/speakers';
  import {
    applyTheme, clearLocalSettings, forgetKey, loadDefaultRetention, loadKeepAudio, loadNotify, loadReviewFirst, loadSavedKey,
    loadTheme, saveDefaultRetention, saveKeepAudio, saveKey, saveNotify, saveReviewFirst, type Theme,
  } from './lib/settings';
  import { BASE_TITLE, notifyIfHidden, requestNotifications, titleFor } from './lib/notify';

  const saved = loadSavedKey();
  let engine = $state<EngineChoice>('local');
  let apiKey = $state(saved);
  let remember = $state(!!saved);
  let model = $state('base');
  let language = $state('auto');
  let theme = $state<Theme>(loadTheme());
  let files = $state<File[]>([]);
  let target = $state('');
  let diarize = $state(false);
  let speakerCount = $state('auto');
  let defaultRetention = $state<Retention>(loadDefaultRetention());
  let keepAudio = $state(loadKeepAudio());
  let reviewFirst = $state(loadReviewFirst());
  let notify = $state(loadNotify());
  let notifyDenied = $state(false);
  let deleted = $state(false);

  type View = 'home' | 'jobs' | 'settings' | 'result';
  let view = $state<View>('home');
  let openId = $state('');
  /** a lone submitted file opens by itself when it finishes, like the one-file flow always did */
  let autoOpen = '';

  let live = $state<LiveItem[]>([]);
  let jobs = $state<StoredJob[]>([]);
  let storageError = $state('');

  const service = new JobService({
    store: new JobStore(),
    run: (item, ctx) => runTask(item.input, ctx),
    defaultRetention: () => $state.snapshot(defaultRetention) as Retention, // proxies cannot go into IndexedDB
    keepAudio: () => keepAudio,
    onSettled: (item) => {
      if (item.status === 'done' && autoOpen === item.id && view === 'jobs') {
        autoOpen = '';
        openId = item.id;
        view = 'result';
      }
      if (item.status === 'done') notifyIfHidden(notify, 'Transcript ready', `${item.name} has finished.`);
      else if (item.status === 'failed') notifyIfHidden(notify, 'Job failed', `${item.name}: ${item.error ?? 'something went wrong.'}`);
    },
  });
  const sync = () => {
    live = service.queue.items;
    jobs = service.jobs;
    storageError = service.storageError;
  };
  service.onChange(sync);

  onMount(() => {
    void service.migrate().then(() => service.refresh()).then(() => service.sweep());
    const t = setInterval(() => void service.sweep(), 60_000);
    return () => clearInterval(t);
  });

  // progress in the tab title, so a background tab shows what is happening
  $effect(() => {
    const running = live.find((i) => i.status === 'running');
    const waiting = live.filter((i) => i.status === 'queued').length;
    document.title = titleFor(running ? { step: running.step, fraction: running.progress?.fraction ?? null } : null, waiting);
    return () => { document.title = BASE_TITLE; };
  });

  applyTheme(loadTheme());
  const cycle = () => {
    theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    applyTheme(theme);
  };

  const canStart = $derived(files.length > 0 && (engine === 'local' || apiKey.trim().length > 0));
  const active = $derived(live.filter((i) => i.status === 'queued' || i.status === 'running').length);
  const openJob = $derived(jobs.find((j) => j.id === openId));
  const translating = $derived(live.find((i) => i.input.kind === 'translate' && i.input.jobId === openId && (i.status === 'queued' || i.status === 'running')));

  function submit() {
    if (!canStart) return;
    if (engine === 'openai') (remember ? saveKey(apiKey.trim()) : forgetKey());
    void navigator.storage?.persist?.().catch(() => {}); // ask the browser not to evict results under pressure
    const options: JobOptions = { engine, apiKey: apiKey.trim(), model, language, target, diarize, speakerCount, reviewFirst };
    const items = service.submit(files, options);
    autoOpen = items.length === 1 ? items[0].id : '';
    files = [];
    view = 'jobs';
  }

  function open(id: string) {
    openId = id;
    view = 'result';
  }
  function setRemember(v: boolean) {
    remember = v;
    if (!v) forgetKey();
    else if (apiKey.trim()) saveKey(apiKey.trim());
  }
  async function setNotify(v: boolean) {
    notifyDenied = false;
    if (v && !(await requestNotifications())) {
      notifyDenied = true;
      v = false;
    }
    notify = v;
    saveNotify(v);
  }
  let usage = $state('');
  async function refreshUsage() {
    try {
      const e = await navigator.storage.estimate();
      usage = `Using ${Math.round((e.usage ?? 0) / 1e6)} MB of about ${Math.round((e.quota ?? 0) / 1e6)} MB available to this site.`;
    } catch {
      usage = '';
    }
  }
  async function clearModels() {
    try {
      await caches?.delete('transformers-cache');
    } catch { /* no Cache API */ }
    await refreshUsage();
  }
  async function deleteAll() {
    try {
      await service.deleteAll();
    } catch (e) {
      storageError = (e as Error).message;
    }
    try {
      await caches?.delete('transformers-cache');
    } catch { /* no Cache API */ }
    clearLocalSettings();
    apiKey = '';
    remember = false;
    keepAudio = false;
    reviewFirst = false;
    notify = false;
    defaultRetention = loadDefaultRetention();
    theme = 'system';
    document.documentElement.removeAttribute('data-theme');
    deleted = true;
    sync();
  }
  function go(v: View) {
    deleted = false;
    view = v;
    if (v === 'settings') void refreshUsage();
  }
</script>

<main>
  <header class="top">
    <div>
      <h1>VTT Transcribe</h1>
      <p class="tag">Audio to text, right in your browser. No account, no server.</p>
    </div>
    <nav aria-label="Main">
      <button type="button" onclick={() => go('home')} aria-current={view === 'home' ? 'page' : undefined}>New</button>
      <button type="button" onclick={() => go('jobs')} aria-current={view === 'jobs' ? 'page' : undefined}>Jobs{active ? ` (${active})` : ''}</button>
      <button type="button" onclick={() => go('settings')} aria-current={view === 'settings' ? 'page' : undefined}>Settings</button>
      <button type="button" onclick={cycle} aria-label="Theme: {theme}. Click to change.">
        {theme === 'dark' ? '🌙 Dark' : theme === 'light' ? '☀️ Light' : '🖥 Auto'}
      </button>
    </nav>
  </header>

  {#if view === 'home'}
    <EnginePicker bind:engine bind:apiKey bind:model bind:language bind:target bind:diarize bind:speakerCount />
    <Dropzone {files} onfiles={(f) => (files = f)} />
    <div class="go">
      <button type="button" class="primary" disabled={!canStart} onclick={submit}>{target || diarize ? 'Transcribe & process' : 'Transcribe'}</button>
      {#if files.length && engine === 'openai' && !apiKey.trim()}
        <span class="hint">Enter your API key to continue.</span>
      {/if}
      {#if files.length > 1}<span class="hint">{files.length} files will run one after another.</span>{/if}
    </div>
  {:else if view === 'jobs'}
    <Jobs
      {live}
      position={(id) => service.queue.position(id)}
      {jobs}
      unsaved={(id) => service.isUnsaved(id)}
      {storageError}
      onnew={() => go('home')}
      oncancel={(id) => service.queue.cancel(id)}
      ondismiss={(id) => service.queue.remove(id)}
      onretry={(id) => service.queue.retry(id)}
      canRetry={(i) => i.input.kind === 'translate' || service.files.has(i.input.jobId)}
      onopen={open}
      ondelete={(id) => void service.delete(id)}
      onretention={(id, r) => void service.setRetention(id, r)}
      onclearerror={() => service.dismissStorageError()}
    />
  {:else if view === 'settings'}
    <Settings
      retention={defaultRetention}
      rememberKey={remember}
      {keepAudio}
      {reviewFirst}
      onreviewfirst={(v) => ((reviewFirst = v), saveReviewFirst(v))}
      {notify}
      {notifyDenied}
      {deleted}
      {usage}
      onclearmodels={() => void clearModels()}
      onretention={(r) => ((defaultRetention = r), saveDefaultRetention(r))}
      onremember={setRemember}
      onkeepaudio={(v) => ((keepAudio = v), saveKeepAudio(v))}
      onnotify={(v) => void setNotify(v)}
      ondeleteall={() => void deleteAll()}
    />
  {:else if openJob}
    {#key openJob.id}
      <Result
        job={openJob}
        {translating}
        loadAudio={() => service.audioFor(openJob.id)}
        onfinish={async (t, n) => {
          const turns = $state.snapshot(t) as Turn[] | null;
          const names = $state.snapshot(n) as SpeakerNames;
          await service.finishReview(openJob.id, turns, names, apiKey.trim());
        }}
        onaddlanguage={(l, e) => void service.addLanguage(openJob.id, l, e, apiKey.trim())}
        onrecluster={(n) => void service.recluster(openJob.id, n)}
        onsetversion={(v) => void service.setActiveVersion(openJob.id, v)}
        onrenameversion={(v, n) => void service.renameVersion(openJob.id, v, n)}
        ondeleteversion={(v) => void service.deleteVersion(openJob.id, v)}
        ondownload={() => void service.markDownloaded(openJob.id)}
        oncancel={(id) => service.queue.cancel(id)}
        onback={() => go('jobs')}
        onnew={() => go('home')}
      />
    {/key}
  {:else}
    <p>That result is no longer here (it may have expired). <button type="button" onclick={() => go('jobs')}>Back to jobs</button></p>
  {/if}

  <footer>
    <p>
      Privacy: this page has no backend. In OpenAI mode your audio and key go only to api.openai.com. In on-device mode
      nothing is uploaded. Finished transcripts are saved only in this browser (see Settings to choose how long, or delete
      everything). See the README to verify.
    </p>
  </footer>
</main>

<style>
  main { max-width: 760px; margin: 0 auto; padding: 1rem 16px 3rem; display: grid; gap: 1rem; }
  .top { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  nav { display: flex; gap: 0.4rem; flex-wrap: wrap; }
  nav [aria-current='page'] { border-color: var(--primary); }
  h1 { margin: 0; font-size: 1.6rem; }
  .tag { margin: 0; color: var(--muted); }
  .go { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }
  .hint { color: var(--muted); font-size: 0.9rem; margin: 0; }
  footer { color: var(--muted); font-size: 0.85rem; margin-top: 1rem; }
</style>
