import { defineConfig, devices } from '@playwright/test';

// Runs against the production build served by `vite preview`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', actionTimeout: 10000 },
  // Projects scope tests to where they apply (no run-time skips):
  //  - fast specs run on 4 engines; real-model specs run once, in 'real'.
  //  - the AAC video needs a browser with an AAC decoder: Chrome, Firefox, WebKit (not open-source Chromium).
  projects: [
    {
      name: 'desktop',
      testIgnore: /(real-.*|gpu|subpath)\.spec\.ts/,
      grepInvert: /aac/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: /(real-.*|gpu|subpath)\.spec\.ts/,
      grepInvert: /aac/,
      use: { ...devices['Pixel 7'] },
    },
    { name: 'firefox', testIgnore: /(real-.*|gpu|subpath)\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: /(real-.*|gpu|subpath)\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    // Branded Chrome (has AAC/H.264): media spec only. Needs `npx playwright install chrome`.
    { name: 'chrome', testMatch: /media\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    // Real Whisper + real speaker models (downloads ~140 MB from huggingface.co), once, WASM in Chromium.
    {
      name: 'real',
      testMatch: /real-model|real-diarize|real-language|real-translate/,
      use: { ...devices['Desktop Chrome'] },
    },
    // The deployed shape: real on-device model served from /vtt-transcribe-web/ (what GitHub Pages does).
    {
      name: 'subpath',
      testMatch: /subpath\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:4174/vtt-transcribe-web/' },
    },
    // WebGPU on the host NVIDIA GPU. Only defined when scripts/e2e.sh detected a GPU and passed it into the container.
    ...(process.env.VTT_GPU
      ? [
          {
            name: 'gpu',
            testMatch: /gpu\.spec\.ts/,
            use: {
              ...devices['Desktop Chrome'],
              launchOptions: {
                args: [
                  '--enable-unsafe-webgpu',
                  '--ignore-gpu-blocklist',
                  '--no-sandbox',
                  '--enable-features=Vulkan',
                  '--use-angle=vulkan',
                  '--disable-gpu-sandbox',
                  '--disable-vulkan-surface',
                ],
              },
            },
          },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'npm run build && npm run preview -- --host 127.0.0.1',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120000,
    },
    // Same build, served from a sub-path like GitHub Pages project sites (after the build above has run).
    {
      command: 'node scripts/serve-subpath.mjs',
      url: 'http://localhost:4174/vtt-transcribe-web/',
      reuseExistingServer: true,
      timeout: 120000,
    },
  ],
});
