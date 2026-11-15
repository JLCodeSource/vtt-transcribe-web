# Publishing vtt-transcribe-web on GitHub Pages

**Live:** https://jlcodesource.github.io/vtt-transcribe-web/ — deployed by `.github/workflows/pages.yml` on every push to `main`
(Pages source: GitHub Actions; Actions restricted to GitHub-owned actions). The options below record how it was set up.

The site is fully static (`dist/`). It must be served from a sub-path (`https://<user>.github.io/vtt-transcribe-web/`);
the build already uses relative URLs and the `subpath` e2e project proves that shape works (including the real model).

## Pre-flight (all done as of this commit)
- [x] `LICENSE` (BSD-3-Clause) and `NOTICE` (third-party + model + fixture credits)
- [x] Secret scan of full git history (gitleaks): web repo clean; core repo only test/CI placeholder keys
- [x] Fixtures use only permissively licensed voices (see `NOTICE`)
- [x] `./scripts/e2e.sh` green (unit + e2e incl. real models, GPU when present)
- [ ] Push local `main` to the private repo and re-run `./scripts/e2e.sh` from a clean clone
- [ ] Read the README once as a stranger would; check no private hostnames/paths remain

## 1. Make the repository public (you, in the browser: irreversible for the history)
GitHub → vtt-transcribe-web → Settings → General → Danger Zone → Change visibility → Make public.
Anyone can then read the whole history, which is why the scans above matter.

## 2. Deploy: pick ONE
### A. Pages from the `gh-pages` branch (no workflow files)
```bash
# build in the container, then push dist/ as an orphan branch
docker run --rm -u $(id -u):$(id -g) -e HOME=/tmp -v "$PWD":/w -w /w node:22-slim npx vite build
cd dist && touch .nojekyll && git init -q -b gh-pages && git add -A \
  && git commit -q -m "Deploy" && git push -f git@github.com:JLCodeSource/vtt-transcribe-web.git gh-pages && cd ..
```
(the force-push is to the throwaway `gh-pages` branch only, never `main`.)
Then Settings → Pages → Source: *Deploy from a branch* → `gh-pages` / `(root)`.
Pages runs GitHub's own build step for this; if it does not start, enable Actions for the repo (free on public repos).

### B. Pages via a GitHub Actions workflow (rebuilds on every push to main)
Settings → Pages → Source: *GitHub Actions*, and add `.github/workflows/pages.yml`:
```yaml
name: pages
on: { push: { branches: [main] }, workflow_dispatch: {} }
permissions: { contents: read, pages: write, id-token: write }
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: { name: github-pages, url: "${{ steps.d.outputs.page_url }}" }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci && npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - id: d
        uses: actions/deploy-pages@v4
```
Free on public repos. Tests stay local (`./scripts/e2e.sh`); the workflow only builds and deploys.

## 3. Verify the live site
1. Open https://jlcodesource.github.io/vtt-transcribe-web/ in Chrome.
2. DevTools → Network: only your origin, `huggingface.co` / `*.hf.co`, and (OpenAI mode) `api.openai.com`.
3. Run the manual table from the README on the live URL: on-device transcription, French detection and translation,
   speaker review, and (optional) the OpenAI path with your own key.
4. Confirm the first on-device run downloads models and the second run reuses the browser cache.

## 4. Take it down
Settings → Pages → Unpublish (or delete the `gh-pages` branch / set the repo back to private).

## Caveats
- GitHub Pages' terms are for static project/personal sites, not for running a commercial service. If this becomes a paid
  product, host it on Cloudflare Pages or Netlify instead (no code changes; the CSP can then also be sent as a header).
- Pages cannot set HTTP headers, so the Content-Security-Policy stays in the `<meta>` tag.
- Models load from huggingface.co at runtime; if Hugging Face is unreachable the on-device engine cannot start.
