import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// Real Whisper (tiny) must detect non-English speech and transcribe it in that language
// (fixtures made by scripts/gen-language-fixtures.sh). Runs in the 'real' project.
test.setTimeout(300000);

const cases = [
  { file: 'speech-fr.mp3', language: 'French', word: /bonjour|aujourd|ordinateur/i },
  { file: 'speech-es.mp3', language: 'Spanish', word: /buenos|hoy|computadora/i },
];

for (const c of cases) {
  test(`auto-detects ${c.language} on-device`, async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Model size').selectOption('tiny');
    await page.getByTestId('file-input').setInputFiles(join(process.cwd(), 'e2e/fixtures', c.file));
    await page.getByRole('button', { name: 'Transcribe' }).click();
    await expect(page.getByTestId('ran-on')).toContainText(`detected language: ${c.language}`, { timeout: 280000 });
    await expect(page.locator('ol')).toContainText(c.word);
  });
}
