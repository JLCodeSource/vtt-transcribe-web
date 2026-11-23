import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Downloads the real speaker models (~100 MB) and runs them in Chromium (WASM) on e2e/fixtures/two-voices.wav:
// a 6-turn conversation between two distinct synthetic voices (made by scripts/gen-two-voice-fixture.sh),
// with exact reference turns in two-voices.rttm. REAL_DIARIZE=/other.wav (+ /other.rttm) overrides the clip.
// Runs in the 'real' Playwright project (needs huggingface.co); exclude it with --project=desktop etc.
const wav = process.env.REAL_DIARIZE ?? join(process.cwd(), 'e2e/fixtures/two-voices.wav');
test.setTimeout(900000);

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' };

test('real speaker models agree with the reference speaker turns', async ({ page }) => {
  const truth = readFileSync(wav!.replace(/\.wav$/, '.rttm'), 'utf8')
    .trim()
    .split('\n')
    .map((l) => l.split(/\s+/))
    .map((f) => ({ start: Number(f[3]), end: Number(f[3]) + Number(f[4]), spk: f[7] }));
  page.on('console', (m) => m.type() === 'error' && console.log('console.error:', m.text()));
  // Transcription is mocked with one segment per reference turn; only the speaker models are real.
  await page.route('https://api.openai.com/**', async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    await route.fulfill({
      status: 200,
      headers: CORS,
      contentType: 'application/json',
      body: JSON.stringify({ segments: truth.map((t, i) => ({ start: t.start, end: t.end, text: `turn ${i}` })) }),
    });
  });
  await page.goto('/');
  await page.getByLabel(/Use OpenAI instead/).check();
  await page.getByLabel('Your OpenAI API key').fill('sk-test');
  await page.getByLabel('Identify the speakers').check();
  await page.getByLabel('How many speakers?').selectOption('2');
  await page.getByTestId('file-input').setInputFiles(wav!);
  const t0 = Date.now();
  await page.getByRole('button', { name: /Transcribe/ }).click();
  const review = page.getByRole('heading', { name: 'Who is who?' });
  const err = page.getByRole('alert');
  await expect(review.or(err)).toBeVisible({ timeout: 880000 });
  console.log(`diarize_ms=${Date.now() - t0}`, 'ALERT:', await err.allInnerTexts());
  await expect(err).toHaveCount(0);
  console.log('FOUND:', await page.locator('.hint').first().innerText());
  await page.getByRole('button', { name: 'Looks good' }).click();
  const lines = await page.locator('ol li span').allInnerTexts();
  const pred = lines.map((l) => /^(Speaker \d+):/.exec(l)?.[1] ?? '?');
  // best one-to-one agreement between predicted and true labels
  const counts = new Map<string, number>();
  truth.forEach((t, i) =>
    counts.set(`${pred[i]}|${t.spk}`, (counts.get(`${pred[i]}|${t.spk}`) ?? 0) + (t.end - t.start)),
  );
  const preds = [...new Set(pred)],
    trues = [...new Set(truth.map((t) => t.spk))];
  let best = 0;
  const perm = (i: number, used: Set<string>, acc: number) => {
    if (i === preds.length) return void (best = Math.max(best, acc));
    perm(i + 1, used, acc);
    for (const tr of trues)
      if (!used.has(tr)) perm(i + 1, new Set([...used, tr]), acc + (counts.get(`${preds[i]}|${tr}`) ?? 0));
  };
  perm(0, new Set(), 0);
  const total = truth.reduce((a, t) => a + t.end - t.start, 0);
  console.log(
    `speakers predicted=${preds.length} true=${trues.length} agreement=${((100 * best) / total).toFixed(1)}%`,
  );
  expect(best / total).toBeGreaterThan(0.8);
});
