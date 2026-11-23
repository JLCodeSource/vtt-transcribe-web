import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// Runs only in the 'gpu' project (scripts/e2e.sh adds it when an NVIDIA GPU is present).
// Real Whisper (tiny) on WebGPU transcribing the sample speech.
test.setTimeout(300000);

test('on-device Whisper runs on WebGPU', async ({ page }) => {
  await page.goto('/');
  const adapter = await page.evaluate(async () => (await navigator.gpu?.requestAdapter())?.info?.vendor ?? null);
  expect(adapter, 'Chromium must expose a WebGPU adapter (is the GPU passed into the container?)').not.toBeNull();
  await expect(page.getByText(/WebGPU, so the GPU will be used/)).toBeVisible();
  await page.getByLabel('Model size').selectOption('tiny');
  await page.getByTestId('file-input').setInputFiles(join(process.cwd(), 'e2e/fixtures/hello_conversation.mp3'));
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByTestId('ran-on')).toHaveText(/GPU \(WebGPU\); detected language: English/, {
    timeout: 280000,
  });
  await expect(page.locator('ol')).toContainText(/hello world/i);
});
