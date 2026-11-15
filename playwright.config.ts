import { defineConfig, devices } from '@playwright/test';

// Runs against the production build served by `vite preview`.
export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  reporter: 'list',
  use: { baseURL: 'http://localhost:4173', actionTimeout: 10000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1',
    url: 'http://localhost:4173',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
