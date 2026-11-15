import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// Fully offline pipeline, no OpenAI: real Whisper tiny detects French, then the real Opus-MT fr->en model translates.
// Runs in the 'real' project (downloads ~40 MB + ~75 MB from Hugging Face).
test.setTimeout(420000);

test('on-device: detect French, then translate to English with real models', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Model size').selectOption('tiny');
  await page.getByLabel('Translate the transcript into').selectOption('en');
  await page.getByTestId('file-input').setInputFiles(join(process.cwd(), 'e2e/fixtures/speech-fr.mp3'));
  await page.getByRole('button', { name: /Transcribe/ }).click();
  await expect(page.getByTestId('ran-on')).toContainText('detected language: French', { timeout: 400000 });
  // The translation is shown by default; "bonjour"/"aujourd'hui" would still be here if it were untranslated.
  await expect(page.locator('ol')).toContainText(/hello|good morning|today|computers/i);
  await expect(page.locator('ol')).not.toContainText(/aujourd|ordinateurs/i);
  // The original stays available.
  await page.getByLabel('Show / export the translation').uncheck();
  await expect(page.locator('ol')).toContainText(/bonjour|aujourd|ordinateur/i);
});
