# SMG Fork Workflow — Phase 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the fork's branch model, upstream sync, CI and image pipeline in place on `Solomedia/cap`, with deploys frozen and no change to Railway.

**Architecture:** Three thin GitHub Actions workflows (`smg-ci`, `smg-sync`, `smg-deploy`) call small Bun TypeScript CLIs in `scripts/smg/`. Every decision those CLIs make lives in pure functions under `scripts/smg/lib/` with `bun test` coverage. Repository settings (default branch, rulesets, disabled inherited workflows, bot app, variables) are applied through `gh` and the GitHub UI, never by editing upstream files.

**Tech Stack:** GitHub Actions, GitHub App token (`actions/create-github-app-token`), `gh` CLI, Bun 1.4.4 (`bun test`, `Bun.$`), TypeScript, Docker Buildx, GHCR, Railway GraphQL API (code only; not called in Phase 0).

**Spec:** `smg/fork-workflow.md` (copied in Task 1 from the approved design `2026-11-08-smg-fork-workflow-design.md`).

## Global Constraints

- Repo `Solomedia/cap`; upstream `CapSoftware/Cap`. Work on branch `internal/fork-workflow` cut from `origin/smg`; PR into `smg`, squash merge. Never commit to `main`.
- SMG-owned paths only: `SMG.md`, `smg/**`, `.github/workflows/smg-*.yml`, `scripts/smg/**`. Do not edit any upstream file, including upstream workflows and `.github/actions/*` (using `./.github/actions/setup-js` is fine).
- Commits and PR text in English, no AI attribution of any kind, commits signed with the developer's local config. No force pushes.
- Package manager `bun@1.4.4`. Tests: `bun test scripts/smg`. Typecheck: `bun run tsc -p scripts/smg` (`scripts/smg/tsconfig.json` holds the same flags upstream uses for `scripts/loops`).
- Format touched files with Biome 2.2.0: `bunx @biomejs/biome@2.2.0 check --write <files>`.
- Sync schedule `0 7 * * *` (07:00 UTC). Sync branch name `sync/upstream-<YYYYMMDD-HHMM>` (UTC).
- Labels: `upstream-sync`, `upstream-conflict`, `has-migrations`.
- Migration path prefix: `packages/database/migrations/`.
- Deploy freeze: repository variable `SMG_DEPLOY_FREEZE`. **Only the exact value `false` (trimmed, case-insensitive) unfreezes.** Missing, empty or any other value means frozen. Phase 0 sets it to `true`.
- Image: `ghcr.io/solomedia/cap-web`, tags `smg-<7-char sha>` and `smg`, platform `linux/amd64` only. Deploy by digest (`ghcr.io/solomedia/cap-web@sha256:…`).
- Railway (code only in Phase 0): API `https://backboard.railway.com/graphql/v2`, header `Project-Access-Token`. Repo variables `RAILWAY_ENVIRONMENT_ID=c69cb47f-c519-443a-b063-866b813005f3`, `RAILWAY_CAP_WEB_SERVICE_ID=3035d845-1a7e-43c5-8c15-c61db41ff384`; health URL `https://cap.solomediagroup.com/api/status`. Secret `RAILWAY_TOKEN` is **not** created in Phase 0.
- Bot secrets: `SMG_BOT_APP_ID`, `SMG_BOT_PRIVATE_KEY`.
- No Railway service, variable or deployment changes in this phase.

## Review Focus

1. `SMG_DEPLOY_FREEZE` missing, empty, `"True "`, `"no"` or a typo → must stay frozen; only `false` deploys. (Task 2, `parseFreeze` tests.)
2. `main` has a commit upstream doesn't (someone pushed to the mirror) → sync never writes a merge commit into `main`, opens one `upstream-conflict` issue about the mirror, and never touches `smg`. (Task 2, `mirrorAction` tests; Task 4 wiring.)
3. A second sync while an `upstream-conflict` issue or a `has-migrations` sync PR is still open → `main` is still fast-forwarded, but no new sync PR is opened. (Task 2, `shouldOpenSyncPr` tests.)
4. Upstream adds a new workflow after the initial cleanup → it gets disabled on the next sync; `smg-*` workflows are never disabled; a file like `smgfoo.yml` or `notsmg-x.yml` is not treated as ours. (Task 3 tests.)
5. Upstream changes only `packages/database/migrations/meta/_journal.json`, or a migration under a nested folder → still `has-migrations`, still no auto-merge. (Task 2, `hasMigrations` tests.)

---

### Task 1: Spec, plan and `SMG.md` on a working branch

**Files:**
- Create: `smg/fork-workflow.md` (the approved design, verbatim)
- Create: `smg/plans/2026-11-08-fork-workflow-phase-0.md` (this plan)
- Modify: `SMG.md` — "Branches" section and "Still to set up" section

**Interfaces:**
- Produces: the spec path every later task cites.

- [ ] **Step 1:** `git fetch origin && git switch -c internal/fork-workflow origin/smg`
- [ ] **Step 2:** Copy the design verbatim to `smg/fork-workflow.md` and this plan to `smg/plans/2026-11-08-fork-workflow-phase-0.md`.
- [ ] **Step 3:** In `SMG.md`, change the `smg` row rule to "Updated by merging `main`, never rebased", change the `feat/<topic>` row to say it is merged into `smg` with a merge commit and never rebased afterwards, link `smg/fork-workflow.md`, add a "Patch ledger" table with columns `Branch | Type | Upstream PR | State | Upstream files touched` and one row: `feat/members-table-search | A | CapSoftware/Cap#3919 | PR open (not in smg) | apps/web/app/(org)/dashboard/settings/organization/components/MembersCard.tsx, apps/web/content/docs/teams.mdx`, and replace "Still to set up" with a pointer to the Phase 0 plan.
- [ ] **Step 4:** Verify: `git diff --stat origin/smg` shows only `SMG.md` and `smg/**`.
- [ ] **Step 5:** Commit: `git add SMG.md smg && git commit -m "docs: add SMG fork workflow design and phase 0 plan"`

### Task 2: Pure decision functions for sync and freeze

**Files:**
- Create: `scripts/smg/lib/freeze.ts`, `scripts/smg/lib/sync.ts`, `scripts/smg/lib/web-tests.ts`, `scripts/smg/web-tests.ts`
- Test: `scripts/smg/__tests__/freeze.test.ts`, `scripts/smg/__tests__/sync.test.ts`, `scripts/smg/__tests__/web-tests.test.ts`

**Interfaces:**
- Produces:
  - `parseFreeze(value: string | undefined): boolean` — `true` means frozen.
  - `type MirrorAction = "push" | "up-to-date" | "diverged"`
  - `mirrorAction(input: { originMain: string; upstreamMain: string; originIsAncestor: boolean }): MirrorAction` — equal shas → `up-to-date`; `origin/main` is an ancestor of `upstream/main` → `push`; otherwise → `diverged`. Why not GitHub's `merge-upstream` API: when the fork has extra commits it can answer with `merge_type: "merge"` and write a merge commit into `main`, silently breaking the mirror. A plain `git push` without `--force` can only fast-forward.
  - `hasMigrations(changedFiles: string[]): string[]` — returns the files under `packages/database/migrations/` (empty array = none).
  - `shouldOpenSyncPr(input: { openConflictIssues: number; openMigrationSyncPrs: number }): boolean`
  - `syncBranchName(now: Date): string` → `sync/upstream-YYYYMMDD-HHMM` in UTC.
  - `buildSyncPr(input: { branch: string; commits: { sha: string; subject: string }[]; migrations: string[] }): { title: string; body: string; labels: string[]; autoMerge: boolean }`
  - `buildConflictIssue(input: { branch: string; conflicts: { file: string; smgCommits: string[] }[] }): { title: string; body: string; labels: string[] }`
  - `buildDivergedIssue(input: { aheadCommits: string[] }): { title: string; body: string; labels: string[] }`
  - In `scripts/smg/lib/web-tests.ts`: `webTestFiles(input: { ciYaml: string; changedFiles: string[] }): string[]` — the test paths listed after `bun run --cwd apps/web test` in the step named `Test web React compatibility` of upstream `.github/workflows/ci.yml`, plus every changed file matching `apps/web/__tests__/**/*.test.ts` (returned relative to `apps/web`), de-duplicated, in that order. Throws when that step is missing or lists no files. Why: the full `apps/web/__tests__/unit` suite is red on upstream `main` (8 failures in 2 files on 2026-11-08), so we run the list upstream itself runs, read at run time so it never drifts and we never edit `ci.yml`.
  - CLI `bun scripts/smg/web-tests.ts --base <ref>` prints `webTestFiles` one per line, reading `.github/workflows/ci.yml` and `git diff --name-only <ref>...HEAD`.

- [ ] **Step 1: Write failing tests**
  - `parseFreeze`: `undefined`, `""`, `"true"`, `"TRUE"`, `"yes"`, `"flase"`, `"0"` → `true`; `"false"`, `" False "`, `"FALSE\n"` → `false`.
  - `mirrorAction`: `{originMain:"a", upstreamMain:"a", originIsAncestor:true}` → `"up-to-date"`; `{"a","b",true}` → `"push"`; `{"a","b",false}` → `"diverged"`.
  - `hasMigrations(["apps/web/a.ts","packages/database/migrations/0057_x.sql","packages/database/migrations/meta/_journal.json","packages/database/schema.ts"])` → the two migration paths; `hasMigrations(["packages/database/migrationsX/a.sql"])` → `[]`.
  - `shouldOpenSyncPr`: `{0,0}` → `true`; `{1,0}` → `false`; `{0,1}` → `false`.
  - `syncBranchName(new Date("2026-11-08T07:00:30Z"))` → `"sync/upstream-20261108-0700"`.
  - `buildSyncPr` with 3 commits and no migrations → title `"Sync upstream 2026-11-08 (3 commits)"` (date taken from the branch name), labels `["upstream-sync"]`, `autoMerge: true`, body lists each `sha subject`; with one migration → labels include `"has-migrations"`, `autoMerge: false`, body contains the migration path and the text `Take a MySQL backup before merging`.
  - `buildConflictIssue` → labels `["upstream-conflict"]`, body lists each file with its `smgCommits` and the resolution steps from spec section 6 step 4.
  - `buildDivergedIssue` → labels `["upstream-conflict"]`, title `"main diverged from upstream"`, body lists `aheadCommits`.
  - `webTestFiles` with a fixture YAML whose step lists `__tests__/unit/a.test.ts` and `__tests__/unit/b.test.ts`, and `changedFiles` `["apps/web/__tests__/unit/b.test.ts","apps/web/__tests__/unit/new.test.ts","apps/web/lib/x.ts"]` → `["__tests__/unit/a.test.ts","__tests__/unit/b.test.ts","__tests__/unit/new.test.ts"]`; a YAML without that step throws; also run it against the real `.github/workflows/ci.yml` and expect more than 50 entries.
- [ ] **Step 2:** Run `bun test scripts/smg` → FAIL (modules not found).
- [ ] **Step 3:** Implement the functions in `scripts/smg/lib/freeze.ts` (`parseFreeze`), `scripts/smg/lib/sync.ts` and `scripts/smg/lib/web-tests.ts`, plus the `web-tests.ts` CLI. No I/O in the `lib/` files. Parse the YAML with the `yaml` package if it is already in `bun.lock`; otherwise extract the step's `run` block with string parsing (do not add a dependency).
- [ ] **Step 4:** Run `bun test scripts/smg` → PASS, and the typecheck command from Global Constraints → no errors.
- [ ] **Step 5:** Commit: `git commit -m "feat(smg): add sync and deploy-freeze decision helpers"`

### Task 3: Disable inherited workflows

**Files:**
- Create: `scripts/smg/lib/workflows.ts`, `scripts/smg/disable-workflows.ts`
- Test: `scripts/smg/__tests__/workflows.test.ts`

**Interfaces:**
- Produces:
  - `isSmgWorkflow(path: string): boolean` — true only when the basename starts with `smg-` and the path is under `.github/workflows/`.
  - `workflowsToDisable(list: { id: number; path: string; state: string }[]): { id: number; path: string }[]` — active (`state === "active"`) and not `isSmgWorkflow`.
  - `disableInheritedWorkflows(input: { repo: string; dryRun: boolean }): Promise<{ disabled: string[]; cancelledRuns: number }>` in `scripts/smg/disable-workflows.ts` (exported, so `sync.ts` imports it) — lists workflows with `gh api repos/<repo>/actions/workflows --paginate`, disables each from `workflowsToDisable` with `gh workflow disable <id> --repo <repo>`, then cancels that workflow's `queued` and `in_progress` runs (`gh run list --workflow <id> --status <s> --json databaseId` → `gh run cancel`). Uses the token in `GH_TOKEN`.
  - CLI entry in the same file: `bun scripts/smg/disable-workflows.ts --repo Solomedia/cap [--dry-run]`, one line per workflow, exit 0.

- [ ] **Step 1: Write failing tests**
  - `isSmgWorkflow`: `.github/workflows/smg-ci.yml` → true; `.github/workflows/ci.yml`, `.github/workflows/smgfoo.yml`, `.github/workflows/notsmg-x.yml`, `scripts/smg-ci.yml` → false.
  - `workflowsToDisable` over `[ci.yml active, smg-sync.yml active, gpui-bench.yml disabled_manually, new-upstream.yml active]` → `[ci.yml, new-upstream.yml]`.
- [ ] **Step 2:** `bun test scripts/smg` → FAIL.
- [ ] **Step 3:** Implement `lib/workflows.ts`, then the CLI with `Bun.$` and `parseArgs` from `node:util`.
- [ ] **Step 4:** `bun test scripts/smg` → PASS; `GH_TOKEN=$(gh auth token) bun scripts/smg/disable-workflows.ts --repo Solomedia/cap --dry-run` → prints the ~32 upstream workflows as "would disable" and none starting with `smg-`.
- [ ] **Step 5:** Commit: `git commit -m "feat(smg): add script to disable inherited upstream workflows"`

### Task 4: Upstream sync workflow

**Files:**
- Create: `scripts/smg/sync.ts`, `.github/workflows/smg-sync.yml`

**Interfaces:**
- Consumes: everything from Task 2; `disable-workflows.ts` from Task 3.
- Produces: CLI `bun scripts/smg/sync.ts --repo Solomedia/cap` (env `GH_TOKEN` = bot token). Exit 0 on every handled outcome, non-zero only on unexpected API errors.

`sync.ts` order (calls `gh api` and `git` through `Bun.$`):
1. `git fetch origin main smg && git fetch upstream main`, then `mirrorAction` with `git merge-base --is-ancestor origin/main upstream/main`. `push` → `git push origin upstream/main:refs/heads/main` (never `--force`). `diverged` → if no open issue titled "main diverged from upstream" exists, create it with `buildDivergedIssue` (ahead commits from `git log --format='%h %s' upstream/main..origin/main`), then exit 0.
2. Run the disable-workflows logic (import the function, not a subprocess), including cancelling runs that the push just started for newly added upstream workflows.
3. `git fetch origin main`. If `git rev-list --count origin/smg..origin/main` is 0 → print "smg already contains main" and exit 0.
4. Count open issues labeled `upstream-conflict` and open PRs labeled `has-migrations` with head `sync/upstream-*`; if `!shouldOpenSyncPr(...)` → print why, exit 0.
5. Trial merge locally: `git switch --detach origin/smg && git merge --no-commit --no-ff origin/main`. If conflicts (`git diff --name-only --diff-filter=U`): for each file collect `git log --first-parent --format='%h %s' origin/main..origin/smg -- <file>`, `git merge --abort`, create issue with `buildConflictIssue` (skip if one is already open), exit 0. Otherwise `git merge --abort`.
6. Create the branch on GitHub at `origin/smg`'s sha (`POST git/refs`), then `POST /repos/<repo>/merges` with `base=<branch>`, `head=main`, `commit_message="Merge upstream main into smg (<date>)"` so GitHub signs the merge commit.
7. Migrations from `hasMigrations(git diff --name-only origin/smg...origin/main)`; commits from `git log --no-merges --format='%h %s' origin/smg..origin/main`. Open the PR with `buildSyncPr`; if `autoMerge`, run `gh pr merge <n> --auto --merge`.

- [ ] **Step 1:** Implement `sync.ts`. Create labels idempotently at the start (`gh label create <name> --force`).
- [ ] **Step 2:** Write `smg-sync.yml`: triggers `schedule: "0 7 * * *"` and `workflow_dispatch`; `concurrency: smg-sync` (no cancel); job on `ubuntu-latest`; steps: `actions/create-github-app-token@v2` with `SMG_BOT_APP_ID`/`SMG_BOT_PRIVATE_KEY` → `actions/checkout@v4` with `fetch-depth: 0` and the app token → `git remote add upstream https://github.com/CapSoftware/Cap.git && git fetch upstream main` → `oven-sh/setup-bun` at the same pinned sha as `.github/actions/setup-js` with `bun-version: 1.4.4` → `bun scripts/smg/sync.ts --repo ${{ github.repository }}` with `GH_TOKEN` set to the app token. Set `permissions: contents: read` (the app token does the writes).
- [ ] **Step 3:** Verify locally: `bunx @biomejs/biome@2.2.0 check scripts/smg`, the typecheck command, `bun test scripts/smg` → all pass. `actionlint .github/workflows/smg-sync.yml` (via `bunx` or `brew`) → no errors.
- [ ] **Step 4:** Commit: `git commit -m "feat(smg): add daily upstream sync workflow"`

### Task 5: CI for pull requests into `smg`

**Files:**
- Create: `.github/workflows/smg-ci.yml`

**Interfaces:**
- Produces: three check runs, the required checks for Task 7: `SMG CI / scripts`, `SMG CI / web`, `SMG CI / docker`.

- [ ] **Step 1:** Write `smg-ci.yml`: `name: SMG CI`, trigger `pull_request` with `branches: [smg]`, plus `workflow_dispatch`. `concurrency` grouped by PR number with `cancel-in-progress: true`. All jobs `ubuntu-latest`.
  - Job `changes`: `dorny/paths-filter@v3` with outputs `web` (`apps/web/**`, `packages/**`, `bun.lock`, `package.json`, `.github/workflows/smg-*.yml`) and `scripts` (`scripts/smg/**`).
  - Job `scripts` (name `scripts`), always runs: `./.github/actions/setup-js`, `bun test scripts/smg`, the typecheck command.
  - Job `web` (name `web`), `if: needs.changes.outputs.web == 'true'`: `./.github/actions/setup-js`, `biomejs/setup-biome@v2` with `version: 2.2.0` then `biome ci . --linter-enabled=false`, `bun run --cwd apps/web next typegen`, `bun run typecheck`, then `bun run --cwd apps/web test $(bun scripts/smg/web-tests.ts --base origin/${{ github.base_ref }})` (checkout with `fetch-depth: 0`).
  - Job `docker` (name `docker`), same `if`: `docker/setup-buildx-action@v3`, `docker/build-push-action@v5` with `context: .`, `file: apps/web/Dockerfile`, `platforms: linux/amd64`, `push: false`, `cache-from: type=gha,scope=smg-web-amd64` (read only on PRs).
  - Skipped jobs report success, so the three names stay usable as required checks.
- [ ] **Step 2:** `actionlint .github/workflows/smg-ci.yml` → no errors.
- [ ] **Step 3:** Commit: `git commit -m "ci(smg): add checks for pull requests into smg"`

### Task 6: Image build and frozen deploy

**Files:**
- Create: `scripts/smg/lib/railway.ts`, `scripts/smg/deploy-railway.ts`, `.github/workflows/smg-deploy.yml`
- Test: `scripts/smg/__tests__/railway.test.ts`

**Interfaces:**
- Consumes: `parseFreeze` (Task 2).
- Produces:
  - `type DeployStatus = "pending" | "success" | "failed"`
  - `interpretDeploymentStatus(status: string): DeployStatus` — Railway `SUCCESS` → `success`; `FAILED`, `CRASHED`, `REMOVED`, `SKIPPED` → `failed`; anything else → `pending`.
  - `deployImage(input: { token: string; environmentId: string; serviceId: string; image: string; fetch?: typeof fetch }): Promise<{ deploymentId: string }>` — updates the service instance source to `image` and starts a deployment through the Railway GraphQL API. Exact mutations are the builder's call (spec section 13); verify them against Railway's API docs.
  - `waitForDeployment(input: { token: string; deploymentId: string; healthUrl: string; timeoutMs: number; fetch?: typeof fetch }): Promise<DeployStatus>` — polls until `success` or `failed`, then requires `healthUrl` to return 200 for `success`.
  - CLI `bun scripts/smg/deploy-railway.ts --image <ref@sha256:…>` reading `SMG_DEPLOY_FREEZE`, `RAILWAY_TOKEN`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_CAP_WEB_SERVICE_ID`, `HEALTH_URL` from env. Frozen → print "Deploy frozen (SMG_DEPLOY_FREEZE)" and exit 0 **before** reading the token. Not frozen and `RAILWAY_TOKEN` empty → exit 1. Image without `@sha256:` → exit 1.

- [ ] **Step 1: Write failing tests** with an injected `fetch` stub:
  - `interpretDeploymentStatus` for `SUCCESS`, `FAILED`, `CRASHED`, `BUILDING`, `DEPLOYING`.
  - `deployImage` sends `Project-Access-Token: <token>` to `https://backboard.railway.com/graphql/v2`, puts the exact image string in the variables, and returns the deployment id from the stubbed response; a GraphQL `errors` array throws.
  - `waitForDeployment` returns `failed` when the health URL answers 503 after `SUCCESS`, and `failed` after `timeoutMs` while still `DEPLOYING`.
- [ ] **Step 2:** `bun test scripts/smg` → FAIL.
- [ ] **Step 3:** Implement `lib/railway.ts` and the CLI.
- [ ] **Step 4:** `bun test scripts/smg` → PASS; `SMG_DEPLOY_FREEZE= bun scripts/smg/deploy-railway.ts --image ghcr.io/solomedia/cap-web@sha256:abc` → prints the frozen line, exit 0.
- [ ] **Step 5:** Write `smg-deploy.yml`: `name: SMG Deploy`; triggers `push: branches: [smg]` and `workflow_dispatch` with optional input `digest`; `concurrency: smg-deploy` (no cancel).
  - Job `build` (skipped when `inputs.digest` is set): `permissions: contents: read, packages: write`; login to GHCR with `GITHUB_TOKEN`; `docker/build-push-action@v5`, `platforms: linux/amd64`, `push: true`, tags `ghcr.io/solomedia/cap-web:smg-${{ short sha }}` and `:smg`, `cache-from`/`cache-to: type=gha,mode=max,scope=smg-web-amd64`; output the digest.
  - Job `deploy` (needs `build`, runs when `build` succeeded or was skipped): `./.github/actions/setup-js`, then `bun scripts/smg/deploy-railway.ts --image ghcr.io/solomedia/cap-web@<digest>` with env from `vars.SMG_DEPLOY_FREEZE`, `secrets.RAILWAY_TOKEN`, `vars.RAILWAY_ENVIRONMENT_ID`, `vars.RAILWAY_CAP_WEB_SERVICE_ID`, `HEALTH_URL=https://cap.solomediagroup.com/api/status`. Write image, digest and commit to `$GITHUB_STEP_SUMMARY`.
- [ ] **Step 6:** `actionlint .github/workflows/smg-deploy.yml` → no errors.
- [ ] **Step 7:** Commit: `git commit -m "feat(smg): build cap-web image and add frozen Railway deploy"`

### Task 7: Open the PR and apply repository settings

Settings marked **(Hildegar)** need the GitHub UI or an owner account; the rest are `gh` commands to run after Hildegar approves them in chat.

- [ ] **Step 1:** Push `internal/fork-workflow` and open a PR into `smg` titled `Add SMG fork workflow: sync, CI and image pipeline` (English, no AI attribution). Wait for review.
- [ ] **Step 2 (Hildegar):** Create GitHub App "SMG Cap Bot" in the Solomedia org with repository permissions Contents RW, Pull requests RW, Issues RW, Workflows RW, Actions RW; install it on `Solomedia/cap` only; store `SMG_BOT_APP_ID` and `SMG_BOT_PRIVATE_KEY` as Actions secrets.
- [ ] **Step 3:** `gh variable set SMG_DEPLOY_FREEZE --body true --repo Solomedia/cap`, plus `RAILWAY_ENVIRONMENT_ID` and `RAILWAY_CAP_WEB_SERVICE_ID` with the values in Global Constraints.
- [ ] **Step 4:** `gh repo edit Solomedia/cap --enable-auto-merge --enable-merge-commit --enable-squash-merge --delete-branch-on-merge`
- [ ] **Step 5:** Squash-merge the PR into `smg`. Then `gh repo edit Solomedia/cap --default-branch smg` (scheduled workflows only run from the default branch).
- [ ] **Step 6:** `GH_TOKEN=$(gh auth token) bun scripts/smg/disable-workflows.ts --repo Solomedia/cap` → every non-`smg-*` workflow shows `disabled_manually` in `gh workflow list --all`.
- [ ] **Step 7:** Rulesets via `gh api repos/Solomedia/cap/rulesets`:
  - `main`: block deletion and non-fast-forward; restrict updates with the SMG Cap Bot app as the only bypass actor.
  - `smg`: block deletion and non-fast-forward; require a pull request (0 approvals); required status checks `scripts`, `web`, `docker` from `SMG CI`.
- [ ] **Step 8:** Verify: `gh api repos/Solomedia/cap/rulesets` lists both; `git push origin HEAD:main` from a scratch commit is rejected (then delete the scratch commit locally).

### Task 8: End-to-end check

- [ ] **Step 1:** `gh workflow run smg-sync.yml --repo Solomedia/cap`, then `gh run watch`. Expected: either "smg already contains main", or a `sync/upstream-*` PR with label `upstream-sync`, a `SMG CI` run, and auto-merge armed (or `has-migrations` and no auto-merge).
- [ ] **Step 2:** After a sync PR merges, `SMG Deploy` runs: `build` pushes `ghcr.io/solomedia/cap-web:smg-<sha>`, and `deploy` ends with "Deploy frozen (SMG_DEPLOY_FREEZE)". Railway Cap Web is unchanged (`get-service-config` still shows the `ghcr.io/capsoftware/cap-web@sha256:e2dbc1e8…` image).
- [ ] **Step 3 (Hildegar):** In the org's Packages settings, make `cap-web` public so Railway can pull it without credentials.
- [ ] **Step 4:** Update the Patch ledger in `SMG.md` if anything changed, and post the results (sync PR link, deploy run link, image digest) in the team channel.

Phase 1 (separate plan, after the 2021–2024 Loom import finishes): create `RAILWAY_TOKEN`; compare migrations between the running image and ours; in one Cap Web deploy switch to our digest, add the AI variables and turn off image auto-updates on Cap Web, Cap Media Server and Cap Loom Importer; set `SMG_DEPLOY_FREEZE=false`.
