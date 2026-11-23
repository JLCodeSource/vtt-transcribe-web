import { expect, test } from '@playwright/test';
import { join } from 'node:path';

// The site is deployed to https://<user>.github.io/vtt-transcribe-web/ (a sub-path). Everything, including the
// self-hosted ONNX Runtime wasm under ort/, must resolve relative to that path. Runs the real tiny model there.
test.setTimeout(300000);

test('works from a sub-path: assets, ONNX runtime and a real transcription', async ({ page }) => {
  const bad: string[] = [];
  page.on('response', (r) => {
    if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
  });
  await page.goto('./');
  await page.getByLabel('Model size').selectOption('tiny');
  await page.getByTestId('file-input').setInputFiles(join(process.cwd(), 'e2e/fixtures/hello_conversation.mp3'));
  await page.getByRole('button', { name: 'Transcribe' }).click();
  await expect(page.getByTestId('ran-on')).toBeVisible({ timeout: 280000 });
  await expect(page.locator('ol')).toContainText(/hello world/i);
  expect(bad).toEqual([]);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((r) => r.name)
        .some((n) => /\/ort\/.*\.wasm/.test(n) && n.includes('/vtt-transcribe-web/ort/')),
    ),
  ).toBe(true);
});
