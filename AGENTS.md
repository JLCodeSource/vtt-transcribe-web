# AGENTS.md: engineering rules for vtt-transcribe-web

Static, serverless Svelte 5 + Vite + transformers.js app that transcribes, translates and diarizes in the browser (on-device or bring-your-own OpenAI key). Code in `src/`, unit tests in `src/__tests__/` (Vitest), e2e in `e2e/` (Playwright, with opt-in real-model projects). Deployed to GitHub Pages from `main`.

These rules apply to the coordinator and to every sub-session. Read them before touching anything. Where another file
(README, an old prompt) disagrees, this file wins. This is the one instruction file; `CLAUDE.md` only imports it.

## 1. Red, green, refactor: mandatory, as three separate commits

1. `test: <what>`: add a failing test and run it. Paste the failure output into the commit body. It must fail for the right
   reason: the behaviour is missing, not a typo, a bad import or a broken fixture.
2. `feat: <what>` or `fix: <what>`: the smallest change that makes the test pass. The whole suite is green.
3. `refactor: <what>`: clean up with the tests still green. Never skip it. If the code you just touched needs nothing, look
   wider (neighbouring modules, shared helpers, duplicated test setup) and make that broader refactor its own commit.

Rules:

- No production code without a failing test that demands it. No "tests to follow".
- Never weaken, skip, comment out or delete a test to reach green. If a test is genuinely wrong, correct it in its own
  `test:` commit that explains why, with evidence (the real behaviour you observed).
- Several small red/green pairs beat one big one.
- Docs-only, CI-only and dependency-only changes (`docs:`, `ci:`, `chore:`) have no red step, but must not change behaviour.

## 2. Commit messages (Conventional Commits)

- Types: `test:`, `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `ci:`. Optional scope: `fix(queue): ...`.
- Subject: imperative, at most about 72 characters, no trailing full stop. No "WIP", "fix stuff", "address review".
- Body: why, not what. `test:` commits include the failure output.
- One logical change per commit.
- Name the work item in a footer line: `Bead: vtt-xxx`. End with the `Co-Authored-By` trailer your environment requires.
- Never rewrite published history. Regular merge commits only: never squash, never force-push `main`.

## 3. Checks before every push

Run the full set: svelte-check, ESLint (warnings are errors), Prettier check and the full test suite. Do not push on red, and
do not claim a check passes unless you ran it and read the result.

The host has no node: use containers. One command runs everything (npm ci, `check`, `lint`, `format:check`, `test`):

```bash
./scripts/check.sh            # add `coverage` as an argument to also print the coverage report
```

`npm run check` is svelte-check; it must report 0 errors and 0 warnings. `npm run format` rewrites files with Prettier; commit
pure formatting changes on their own. CI (`.github/workflows/ci.yml`) runs the same gates plus coverage on every PR that touches
code. Coverage has no threshold yet. Run the Playwright e2e (`./scripts/e2e.sh`, see README) whenever you change UI behaviour;
real-model projects run when you change models or pipelines. E2e is not part of CI.

### Landing a branch (how every task ends)

1. Push the branch and open a pull request. Never push to `main` directly and never merge a branch into `main` without a PR.
   The PR shows the whole diff since the branch point and links the bead.
2. Watch CI to the end (`gh pr checks <number> --watch`). If a check fails, find the cause in the logs and fix it with new
   commits (red, green, refactor still applies). Never merge on red or while checks are pending.
3. If the repository has automatic GitHub Copilot code review, wait for it (up to 15 minutes) and address reasonable feedback.
4. A worker stops when its PR is merge-ready (all checks green, feedback addressed) and reports; the coordinator reviews
   (section 5) and merges with a regular merge commit, or a worker merges only when told to.
5. Beads are synced with `bd dolt push` in the beads workspace (section 4). The old `bd sync` into the repository is retired.

## 4. Work items: beads, outside the code repos

- The single source of truth is the beads workspace `/home/vetch101/code/JLCodeSource/vtt-beads`
  (`cd` there, or `BEADS_DIR=/home/vetch101/code/JLCodeSource/vtt-beads/.beads`). Remote: private repo `JLCodeSource/vtt-beads`.
- Never commit `.beads/` or `issues.jsonl` into a code repo, and never open a beads-only PR. After you change beads run
  `bd dolt push`. Keep `metrics.disabled` true.
- Every task has acceptance criteria, a priority and dependencies written in the bead. `bd ready` lists unblocked work; `bd prime` explains the tool; `bd show <id>` before you start;
  `bd update <id> --status in_progress`; `bd close <id>` only when merged and reviewed.
- Found something outside your task? Do not widen scope. File a bead (`bd create ... --deps discovered-from:<id>`) and report it.

## 5. Coordinator and workers

- The coordinator dispatches only tasks whose dependencies are done, highest priority first, with about three sub-sessions
  in parallel on non-overlapping areas, and names the parallel workers in each prompt.
- A worker follows `docs/worker-prompt.md`: one task, its own branch, strict red/green/refactor commits, runs all checks, rebases
  on the latest `main`, pushes, reports. Blocked means: record why and stop. Never guess or work around a blocker.
- The coordinator reviews every result before accepting it: reads `git log` (a `test:` commit with failure output precedes each
  `feat:`/`fix:`, and a `refactor:` commit exists); reads the diff of any later `test:` commit that changes an assertion to
  confirm it is an evidenced correction, not a loosening; runs the checks itself on `main`. A wrong order or a missing refactor
  goes back to the worker with specific feedback; the coordinator does not patch it.

## 6. Closing a session down (every worker, every time)

When your work is finished, do all of this, then stop and wait. Do not archive yourself.

1. Close off anything necessary: docs, changelog, stray branches and temp files, bead status accurate.
2. Raise follow-on beads for improvements to the system or platform and for wider refactorings that would warrant a bigger
   change, each with acceptance criteria and a link to the bead it came from.
3. `bd dolt push`.
4. Send the coordinator a readiness report: task ID, outcome, commits, tests added, follow-on beads, what you checked and what
   you did not, and an explicit statement that you are ready to be archived.
5. Archiving happens only after the user approves. The coordinator asks; nobody archives on their own.

## 7. Outward-facing actions need the user's explicit approval

Releases and tags, publishing packages or images, public PRs or issues on other projects, posting anywhere, changing
repository visibility or settings, and spending money. A merge to this repo's `main` after green checks is fine.
