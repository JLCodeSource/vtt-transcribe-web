import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// Opt-in spike: downloads a real Whisper model from Hugging Face and runs it in headless Chromium (WASM, no GPU).
// REAL_MODEL=tiny npx playwright test real-model
const model = process.env.REAL_MODEL;
test.skip(!model, 'set REAL_MODEL=tiny|base|small to run');
test.setTimeout(600000);

test('real on-device Whisper', async ({ page }) => {
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log('console.error:', m.text()));
  await page.goto('/');
  await page.getByLabel('Model size').selectOption(model!);
  await page.getByTestId('file-input').setInputFiles(join(process.cwd(), 'e2e/fixtures/hello_conversation.mp3'));
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Transcribe' }).click();
  const done = page.getByRole('heading', { name: 'Transcript' });
  const err = page.getByRole('alert');
  await expect(done.or(err)).toBeVisible({ timeout: 580000 });
  console.log(`MODEL=${model} total_ms=${Date.now() - t0}`);
  console.log('ALERT:', await err.allInnerTexts()); console.log('RESULT:', (await page.locator('ol li').allInnerTexts()).join(' | ').replace(/\n/g, ' '));
  await expect(err).toHaveCount(0);
});
