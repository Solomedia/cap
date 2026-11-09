# SMG fork workflow: fast deploys, upstream PRs, conflict-free sync

Date: 2026-11-08
Repo: `Solomedia/cap` (public fork of `CapSoftware/Cap`, AGPLv3)
Target location once approved: `smg/fork-workflow.md` on branch `smg`, with `SMG.md` "Branches" section updated to point to it.

## 1. Intent

We run Cap self-hosted on Railway (project "SMG - CAP") and want to improve it quickly without becoming a divergent fork. Three things must work at the same time:

1. **Fast deploys.** A merged improvement reaches production in minutes, not days, with one-click rollback.
2. **Upstream contributions.** Every improvement that is valid for the main project goes to `CapSoftware/Cap` as its own PR, from the same branch we use internally.
3. **Continuous upstream sync.** Every upstream update reaches us automatically, without manual merging in the common case, and without breaking production.

The why: upstream moves fast (about 550 merged PRs in three months, one maintainer merging), the official `cap-web` image is published by hand with gaps of up to two months, and every patch we carry costs rebase work. The cheapest fork is the one that carries few patches, builds its own image, and sends everything else upstream.

## 2. Goals, non-goals, anti-goals

Goals
- Upstream changes flow in daily with zero human work when there is no conflict.
- Our improvements deploy on merge, gated by CI and a deploy freeze switch.
- Each upstream-able improvement is one branch that serves both the upstream PR and our deploy.
- When upstream merges our PR, our copy disappears on the next sync with no extra work.
- Anyone on the team can see what we carry on top of upstream at any moment.

Non-goals
- Desktop app, CLI, iOS app and Chrome extension. We use the official builds. Scope is `apps/web`, `apps/media-server` and shared `packages/*` (already in `SMG.md`).
- Running upstream's own CI on the fork.
- A staging environment in the first version (see section 12).
- Building or deploying `Cap Media Server` and `Cap Loom Importer` in the first version. Upstream publishes `cap-media-server` on every push to `main`, so the official image stays current. Both services stay on the official image pinned by digest, with Railway auto-updates turned off so neither restarts on its own (the importer runs Loom imports with a volume and a 600 s drain). Their digest is bumped by hand when a sync needs it. *(Builder call.)*

Anti-goals (failure even if it "works")
- A deploy during an announced long job (Loom import, bulk transcription) that orphans in-flight work. Short user-triggered jobs interrupted by a deploy are an accepted trade-off (section 8).
- Force-pushing shared branches (`main`, `smg`).
- SMG-only database migrations: they collide with upstream's migration journal and break future syncs.
- Editing upstream files just to make the fork work (workflows, configs) when a setting outside the code does the job.
- Patches that change upstream's hosted-product behavior by default.

## 3. Constraints and verified facts

- Upstream merges PRs with **merge commits**, including external PRs (for example "Merge pull request #3775 from yashranaway/fix/shape-track"). Our commits keep their SHAs when upstream merges them. This is what makes patch drop automatic (section 7).
- Upstream closes PRs that fall behind `main` after about a month. Updating a PR by merging `main` into it keeps it current.
- `apps/web/instrumentation.node.ts` runs database migrations on server start. Any image with new migrations changes the production schema on deploy.
- Upstream `ci.yml` runs on `push` to `main` and on every `pull_request`, on `blacksmith-8vcpu` runners that the fork does not have. About 20 of the 32 inherited workflows trigger on push or pull_request (desktop, GPUI benches, reliability suites).
- `docker-build-web.yml` already publishes to `ghcr.io/<owner>/cap-web` using the repo owner, so it produces `ghcr.io/solomedia/cap-web` on the fork.
- Actions are enabled on the fork; the fork is public.
- Production Cap Web on Railway runs an image pinned by digest (`ghcr.io/capsoftware/cap-web@sha256:…`), healthcheck `/api/status`, restart ALWAYS, 12 GB limit, one replica, 30 s overlap. Railway image auto-updates are configured on it today.
- Cap Web's in-process workflows (Loom imports, transcription, AI generation) live in `.workflow-data`, which is not on a volume. **Every deploy interrupts in-flight workflows.** This drives the freeze switch and the sync window.
- Pushes and PRs made with the default `GITHUB_TOKEN` do not trigger other workflows. Automation that must trigger CI needs a GitHub App token.
- Team rules: commits and PRs in English, no AI attribution, commits signed locally, never commit to `main`, force pushes are blocked by local hooks, package manager is `bun` in this repo.

## 4. Branch model

| Branch | What it is | Who writes | Protection |
| --- | --- | --- | --- |
| `main` | Exact mirror of `CapSoftware/Cap:main` | Sync bot only (fast-forward) | No direct pushes, no force push |
| `smg` | `main` + our patches. Production images build from here. Default branch of the fork. | PRs only | PR required, required checks, no force push, merge commits allowed |
| `feat/<topic>` | One upstream-able improvement | Developer | None |
| `internal/<topic>` | One SMG-only change (ops scripts, branding, config). Not `smg/<topic>`: git cannot hold `smg/…` next to a branch named `smg`. | Developer | None |
| `sync/upstream-<date>` | Bot branch: `smg` + merge of `main` | Sync bot | None, deleted after merge |

Change from the current `SMG.md`: `smg` is **updated by merging `main`, never rebased**. Rebasing a deploy branch requires force pushes, rewrites the commits production was built from, and breaks every open branch based on it.

Making `smg` the default branch means new clones, PR targets and the GitHub UI land on what we actually run. `main` stays a pristine mirror.

## 5. The three kinds of change

**A. Upstream-able improvement (`feat/<topic>`)**
1. Branch from an up-to-date `main`, not `smg`, so the diff against upstream contains only this change.
2. Follow upstream conventions: Biome formatting, tests next to the change, small single-concern diff. New behavior that only makes sense self-hosted goes behind an env var or a self-hosting check.
3. Open PR #1: `Solomedia:feat/<topic>` → `Solomedia:smg`, merged with a **merge commit** (not squash). This deploys it to us.
4. Open PR #2: `Solomedia:feat/<topic>` → `CapSoftware/Cap:main`, with "Allow edits by maintainers" on.
5. Review changes go in as **new commits** on the same branch, then re-merge into `smg`. To refresh against upstream, merge `main` into the branch. **Never rebase a `feat/*` branch after it has been merged into `smg`.**
6. Record it in the patch ledger (section 10).

**B. SMG-only change (`internal/<topic>`)**
Branch from `smg`, PR into `smg`, squash merge. Allowed only when it cannot reasonably live upstream. Prefer new files in SMG-owned paths (section 9) over edits to upstream files. No schema changes, ever: a schema change goes upstream first as type A.

**C. Operations (variables, Railway settings, deploy freeze)**
Not in git history beyond documentation. Changed through Railway or repository variables, coordinated in the team channel.

## 6. Upstream sync

Workflow `smg-sync.yml`, scheduled daily at 07:00 UTC (night in the Americas) plus manual dispatch.

Until the sync bot exists (decided by Hildegar, 2026-11-08: not created yet), the workflow stays off behind `SMG_BOT_ENABLED` and Hildegar runs `scripts/smg/sync.ts` by hand once a week with Hildegar's own `gh` login, first with `--dry-run`. The steps below are the same either way. A personal token triggers CI on the sync PR, which the default `GITHUB_TOKEN` would not.

1. Fast-forward `main` to `CapSoftware/Cap:main` with a plain `git push` (never `--force`) as the sync bot. GitHub's "sync fork" API is not used: when the fork has extra commits it can write a merge commit into `main`. If `main` cannot fast-forward, someone committed to it: open an issue and stop.
2. Create `sync/upstream-<date>` from `smg`, run `git merge main`.
3. **No conflict:** open a PR into `smg` titled `Sync upstream <date> (<n> commits)` with the upstream commit list, enable auto-merge. CI runs (section 8); when green it merges and deploys in the same window.
4. **Conflict:** open an **issue** labeled `upstream-conflict` (a PR with no diff cannot be opened) listing the conflicting files and the `smg` commits that touched each. A developer resolves it on a `sync/upstream-*` branch and opens the PR. Later syncs keep `main` current but open no new sync PR until the issue is closed, so conflicts never stack.
5. If there are no new upstream commits, do nothing.
6. **Migration gate:** if the sync adds files under `packages/database/migrations/**`, the PR gets label `has-migrations` and no auto-merge. A developer reads the migrations, takes a MySQL backup, adds the `migrations-approved` label and merges by hand. The same gate applies to every PR into `smg`, not only syncs: a `feat/*` branch cut from a newer `main`, or a conflict fix, can also bring upstream migrations (the `migrations` check in `smg-ci`). Migrations run on server start and before the healthcheck, so rolling back the image digest does not roll back the schema. *(Builder call.)*

Developers should enable `git config rerere.enabled true` locally so a resolved conflict is reused if it reappears.

## 7. When upstream merges our PR

Because upstream uses merge commits and keeps our SHAs, the next sync brings in commits `smg` already has. Git treats them as already merged: no conflict, no duplicate, nothing to revert. The only step is moving the ledger row to "Merged upstream".

Two cases need a human, and the sync PR surfaces both as a conflict:
- Upstream rewrote our change (squash, reimplementation, maintainer edits we never merged into `smg`): resolve in favor of upstream's version for those files.
- We rebased the `feat/*` branch despite the rule: same resolution.

## 8. CI and deploy pipeline

**`smg-ci.yml`**: on PRs into `smg`, on `ubuntu-latest`, with path filters so desktop-only changes skip it:
- `bun install --frozen-lockfile`, Biome check, typecheck and unit tests for `apps/web` (and `apps/media-server` when touched).
- Docker build of `apps/web/Dockerfile` without pushing, to catch build breaks before merge.
- `migrations`: fails while the PR brings migrations and lacks the `migrations-approved` label.
- `ci-ok`: one aggregate job that fails if any job above failed or was cancelled. It is the **only** required check: a skipped job counts as passing, so requiring the individual jobs would let a PR merge untested when the change-detection job itself fails.

One sync PR at a time: while a sync PR is open (pending, red or held for migrations), the next sync keeps `main` current but opens no new PR.

*(Superseded on 2026-11-09 by section 15: Railway builds Cap Web from GitHub.)*

**`smg-deploy.yml`**: on push to `smg` (and manual dispatch with an optional commit or digest for rollback):
1. Build `apps/web/Dockerfile` for `linux/amd64` only (Railway's platform), with Actions cache. Push `ghcr.io/solomedia/cap-web:smg-<shortsha>` (immutable) and `:smg` (moving). Media server stays on the official image in the first version (section 2).
2. If repository variable `SMG_DEPLOY_FREEZE` is `true`, stop here: the image exists, nothing deploys. The job summary says so.
3. Otherwise, through the Railway API with a project token scoped to production, set Cap Web's source to the new image **by digest** and deploy.
4. Wait for the deployment to report success and `/api/status` to return 200. On failure, mark the run failed; Railway keeps the previous container serving because the healthcheck gates the switch.
5. Write the digest, commit and previous digest to the job summary.

Rollback: run `smg-deploy` manually with the previous digest, or use Railway's rollback. The previous digest is always in the last successful run's summary. A rollback across a deploy that ran migrations is code-only: the schema stays new. Use it only when the old code is known to work with the new schema; otherwise restore the backup taken at the migration gate (section 6).

Deploy freeze: set `SMG_DEPLOY_FREEZE=true` before any long-running job on Cap Web (Loom imports, bulk transcription) and back to `false` after. Syncs and merges keep building images during a freeze; the first deploy after unfreezing ships the latest.

Speed target: merge to live in about 15 minutes (image build dominates).

Deploy cadence (decided by Hildegar, 2026-11-08): our merges into `smg` deploy **immediately**, not in a nightly window. Accepted trade-off: a deploy interrupts transcription and AI jobs that users have running at that moment. The freeze switch covers announced long jobs (Loom imports, bulk transcription). The upstream sync keeps its 07:00 UTC schedule. Phase 2's `.workflow-data` volume is the way to remove this trade-off.

## 9. Fork hygiene and conflict-avoidance rules

- **Inherited workflows:** disable every non-`smg-*` workflow through the GitHub API (`gh workflow disable`). This lives in repository settings, not in files, so it never conflicts with upstream. A small step in `smg-sync.yml` disables any newly added upstream workflow after each sync.
- **SMG-owned paths:** `SMG.md`, `smg/**`, `.github/workflows/smg-*.yml`, `scripts/smg/**`. Upstream never touches these, so they never conflict.
- **Patch budget:** minimal diffs in upstream files, behind env flags. The more upstream files we touch, the more syncs conflict.
- **No SMG-only migrations** (see anti-goals).
- **One concern per branch.** Small branches merge upstream faster (85% merged, median 28 h in the web scope) and leave our ledger faster.
- **Upstream etiquette:** answer Greptile the same day, keep PRs current by merging `main`, follow their commit style (`feat(web): …`, `fix(media-server): …`).

## 10. Patch ledger

A table in `SMG.md` with one row per carried change: branch, type (A or B), upstream PR link, state (`In smg`, `PR open`, `Merged upstream`, `Rejected upstream → SMG-only`), and the upstream files it touches.

`git log --first-parent --oneline main..smg` is the source of truth for what we carry. The ledger is the human-readable view and feeds the conflict report in sync PRs.

## 11. Access and secrets

- **Sync bot:** a GitHub App installed on `Solomedia/cap` with contents and pull-request write, so its pushes and PRs trigger CI. It is the only actor allowed to update `main`.
- **`RAILWAY_TOKEN`:** a Railway project token for "SMG - CAP" production, stored as a repository secret: the plan job runs on PRs, which the `production` environment doesn't admit. The apply job also runs in the `production` environment, limited to `smg`. *(Changed on 2026-11-09, section 15.)*

## 12. Rollout

Phase 0, now, with no Railway changes (the 2021–2024 Loom import is running):
1. Make `smg` the default branch and add branch protections.
2. Disable inherited workflows.
3. Create the sync bot app.
4. Add `smg-ci.yml`, `smg-sync.yml` and `smg-deploy.yml` with `SMG_DEPLOY_FREEZE=true`.
5. Let sync run for a few days; confirm images build.

Phase 1, after the import finishes and the migration session confirms:
- In one Cap Web deploy: switch to `ghcr.io/solomedia/cap-web@<digest>`, add the AI variables already planned (`AI_PROVIDER`, `AI_MODEL`, `ASSEMBLY_API_KEY`, `ANTHROPIC_API_KEY`), and turn off image auto-updates.
- Before that deploy, compare migrations in our image against the running one, because migrations apply on start.
- Unfreeze.

Phase 2, later:
- Persist `.workflow-data` on a Railway volume, if Cap's workflow runtime resumes from it, so deploys stop orphaning jobs. Needs verification.
- A staging Railway environment with its own database for risky changes.
- Automate the ledger state from upstream PR status.

## 13. Decided vs left to the builder

Decided in this design
- Merge-based `smg` (no rebase), `feat/*` from `main`, merge-commit merges into `smg`.
- Daily scheduled sync through a PR with auto-merge on green CI.
- ~~Our own image on GHCR, deployed by digest through the Railway API, with a freeze switch.~~ Replaced on 2026-11-09: Railway builds from GitHub with Wait for CI, config in `.railway/railway.ts` (section 15).
- Inherited workflows disabled through settings, not file edits.
- No SMG-only migrations.

Left to the builder
- The exact Railway API calls (GraphQL mutations or CLI) to set the image digest and wait for health.
- Path filters and job split in `smg-ci.yml`, and cache tuning to hit the time target.
- How the sync bot finds which ledger patches touch conflicting files.
- Wording of PR and issue templates.

## 14. Rejected alternatives

- **Rebased patch stack on top of `main`:** clean history, but force pushes on the deploy branch, blocked by our hooks, breaks open branches and loses the link between production and a stable commit.
- ~~**Railway building from the repo:** every push redeploys automatically with no freeze or approval, the monorepo build runs on Railway's builders, and rollback is coarser than a digest.~~ Reversed on 2026-11-09 (section 15): Wait for CI gates each deploy, the autodeploy toggle is the freeze, and Railway rolls back to any earlier deployment.
- **Keeping the official image and patching nothing:** upstream publishes `cap-web` by hand with gaps of up to two months, so we would wait for fixes even with zero patches.

## 15. Amendment 2026-11-09: Railway builds from GitHub, config as IaC

Decided by Hildegar on 2026-11-09, replacing the GHCR image and our deploy script (`smg-deploy.yml`, `scripts/smg/deploy-railway.ts`).

- **Build and deploy:** Cap Web's source is `github("Solomedia/cap", { branch: "smg" })`, built from `smg/web.Dockerfile` (generated from `apps/web/Dockerfile`), with Wait for CI (`checkSuites`). Railway deploys a commit only after the workflows that run on its push succeed. `SMG CI` runs on push to `smg` for that reason, without the Docker job, since Railway builds the image. Watch patterns limit builds to the web app and the packages it uses.
- **Config:** Cap Web's Railway settings live in `.railway/railway.ts` (Railway Infrastructure as Code; `railway.json` is deprecated and stops working on 2026-12-01). The file is the `cap-web` partial: it owns only Cap Web, so it can't delete or change MySQL, Cap Media Server, Cap Loom Importer or `cap-admin-library-sync`. Variables are unmanaged and stay in Railway.
- **Changes to the config** go through PRs: `SMG Railway plan` comments the plan and pins it; on merge, `SMG Railway apply` applies that exact plan, or fails if Railway changed since.
- **Freeze and rollback:** turn off Cap Web's GitHub autodeploy to stop deploys; roll back by redeploying an earlier deployment in Railway. The migration gate (section 6) is unchanged and still the only protection for the schema.
- **Why:** less code of ours on the way to production (the deploy script called Railway GraphQL mutations never tested against production), one environment (no need for one image deployed in several places), and infra changes reviewed in PRs.
- **Cutover:** a separate PR switches the source from the official image, merged in a maintenance window: MySQL backup, Loom import paused and drained, official digest `e2dbc1e8…` kept for rollback.
