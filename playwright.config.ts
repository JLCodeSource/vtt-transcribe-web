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
    { name: 'desktop', testIgnore: /(real-.*|gpu)\.spec\.ts/, grepInvert: /aac/, use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', testIgnore: /(real-.*|gpu)\.spec\.ts/, grepInvert: /aac/, use: { ...devices['Pixel 7'] } },
    { name: 'firefox', testIgnore: /(real-.*|gpu)\.spec\.ts/, use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', testIgnore: /(real-.*|gpu)\.spec\.ts/, use: { ...devices['Desktop Safari'] } },
    // Branded Chrome (has AAC/H.264): media spec only. Needs `npx playwright install chrome`.
    { name: 'chrome', testMatch: /media\.spec\.ts/, use: { ...devices['Desktop Chrome'], channel: 'chrome' } },
    // Real Whisper + real speaker models (downloads ~140 MB from huggingface.co), once, WASM in Chromium.
    { name: 'real', testMatch: /real-model|real-diarize/, use: { ...devices['Desktop Chrome'] } },
    // WebGPU on the host NVIDIA GPU. Only defined when scripts/e2e.sh detected a GPU and passed it into the container.
    ...(process.env.VTT_GPU
      ? [{
          name: 'gpu',
          testMatch: /gpu\.spec\.ts/,
          use: {
            ...devices['Desktop Chrome'],
            launchOptions: {
              args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--no-sandbox', '--enable-features=Vulkan',
                     '--use-angle=vulkan', '--disable-gpu-sandbox', '--disable-vulkan-surface'],
            },
          },
        }]
      : []),
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
