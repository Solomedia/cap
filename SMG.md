# SMG fork of Cap

This is Solo Media Group's fork of [CapSoftware/Cap](https://github.com/CapSoftware/Cap), licensed under AGPLv3 like upstream. We run it self-hosted for internal use only. Nothing here is sold or offered as a service.

Our goal is to stay current with upstream and carry as few patches as possible. Every change is built so it can go upstream as a pull request; once upstream merges it, we drop our copy.

## Branches

Full workflow: [smg/fork-workflow.md](smg/fork-workflow.md).

| Branch | Purpose | Rules |
| --- | --- | --- |
| `main` | Exact mirror of `CapSoftware/Cap:main` | Never commit here. Fast-forwarded from upstream by the sync bot only. |
| `smg` | `main` + our patches. Production images build from here. Default branch. | Changes land through PRs. Updated by merging `main`, never rebased. |
| `feat/<topic>` | One upstream-able improvement | Branched from `main` (not `smg`) so the same branch can open a PR against upstream. Merged into `smg` with a merge commit, never rebased afterwards. |
| `internal/<topic>` | One SMG-only change | Branched from `smg`, squash-merged into `smg`. Not `smg/<topic>`: git cannot hold `smg/…` next to a branch named `smg`. |

Flow for every improvement:

1. Branch `feat/<topic>` from an up-to-date `main`.
2. Put new behavior behind an environment variable or a self-hosting check, so upstream's hosted product is unaffected by default.
3. Open a PR into `smg` (merge commit) so we can use it before upstream reviews it.
4. Open the PR against `CapSoftware/Cap:main` from the same branch, following their conventions (Biome formatting, tests next to the change).
5. Address review with new commits, and keep it current by merging `main` into it. When upstream merges it, the next sync brings the same commits and our copy disappears with no extra work.

## Weekly sync (manual, until the sync bot exists)

The scheduled `SMG Sync` workflow stays off until the "SMG Cap Bot" GitHub App is created and `SMG_BOT_ENABLED=true` is set. Until then, run the same script by hand once a week from a clone with `origin` = `Solomedia/cap` and `upstream` = `CapSoftware/Cap`:

```bash
GH_TOKEN=$(gh auth token) bun scripts/smg/sync.ts --repo Solomedia/cap --dry-run
GH_TOKEN=$(gh auth token) bun scripts/smg/sync.ts --repo Solomedia/cap
```

The first command only prints what would happen. The second one fast-forwards `main`, turns off any new upstream workflow, and opens the sync PR into `smg` (auto-merge on green CI, or held when it brings migrations). It uses a temporary worktree, so your checkout and branch are not touched.

## Patch ledger

What we carry on top of upstream. `git log --first-parent --oneline main..smg` is the source of truth; this table is the readable view.

| Branch | Type | Upstream PR | State | Upstream files touched |
| --- | --- | --- | --- | --- |
| `feat/members-table-search` | A | [CapSoftware/Cap#3919](https://github.com/CapSoftware/Cap/pull/3919) | PR open (not in smg) | `apps/web/app/(org)/dashboard/settings/organization/components/MembersCard.tsx`, `apps/web/content/docs/teams.mdx` |

Type A: upstream-able (`feat/*`). Type B: SMG-only (`internal/*`). States: `In smg`, `PR open`, `Merged upstream`, `Rejected upstream → SMG-only`.

## Scope

Only the server side: `apps/web`, `apps/media-server` and shared `packages/*`. The desktop app, CLI and Chrome extension stay on the official builds.

## How upstream reviews contributions

Measured on 2026-11-06 from the last ~3,000 pull requests.

- Very active: about 550 internal pull requests merged in the last three months. One maintainer (`richiemcilroy`) merges every pull request.
- External pull requests since August 2026: 74% merged, median 24 hours to merge. In the web and self-hosting scope (`web`, `web-backend`, `media-server`, `loom`, `storage`): 85% merged, median 28 hours.
- A new contributor's first pull request: 57% merged, median about 3.5 days.
- Gates: a Greptile review must reach 5/5 before merge, and CI on a first-time contributor's pull request waits for maintainer approval.
- Stale sweeps: pull requests that fall behind `main` are closed as stale after about a month ("reopen against current main"). This is how both pull requests for [#1993](https://github.com/CapSoftware/Cap/issues/1993) were closed.
- Some issues carry bounties (`💎 Bounty`, `$30` to `$500` labels).

What this means for us: send small pull requests, one concern each, with tests. Answer Greptile the same day, and rebase until merged. Main moves by hundreds of pull requests a month, so every patch we carry in `smg` costs rebase work. Carry as few as possible.

## Improvement roadmap

Found while migrating our Loom workspace to a self-hosted Cap instance. Checked against upstream issues and pull requests on 2026-11-06.

| # | Improvement | Why | Upstream state | Decision |
| --- | --- | --- | --- | --- |
| 1 | Loom link map: export Loom URL to Cap URL | Old `loom.com` links in tickets and PRs stop working once Loom is cancelled. We can't redirect Loom's domain, so we rewrite the links. | Nothing open. The `imported_videos` table already keeps the Loom video id. | Internal script first (no patch). Propose an export button upstream later. |
| 2 | ~~Org admins can browse members' libraries~~ | Not wanted: upstream's default (admins only see their own caps and what is shared with them) is the right behavior. We only need it temporarily, to clean up personal or junk videos after the Loom migration. | — | Dropped. The `cap-admin-library-sync` function and its private space are temporary and get removed after the cleanup. |
| 3 | Transfer organization ownership | No way to move the owner role | Nothing open. Related: [#2741](https://github.com/CapSoftware/Cap/pull/2741) (single recording transfer, maintainer, open) and org-to-org content transfer (merged in July). | Open an issue first |
| 4 | `CAP_DISABLE_ORGANIZATION_CREATION` | Single-org self-hosted instances need to stop new orgs (UI, signup and API) | Nothing open | PR. Small, self-hosting only. |
| 5 | Hide storage integrations that are not configured | Google Drive "Connect" shows without Google credentials and fails | Nothing open | PR. Small. |
| 6 | Loom reassignment keeps sharing and spaces | Reassign made caps private and removed them from spaces | **Done upstream**: [#3097](https://github.com/CapSoftware/Cap/pull/3097) adds `/api/internal/loom-imports/backfill` with `keepSharing` | Dropped. Use the backfill endpoint. |
| 7 | Loom import into an organization folder | We ended up with one space per Loom folder | **Mostly done**: [#3097](https://github.com/CapSoftware/Cap/pull/3097) sets `folderId` and `shareFolderId` on imported caps. The CLI still only takes `--space`. | Use the backfill endpoint. A CLI `--folder` flag is optional. |
| 8 | Retry a failed Loom import with a different owner | A failed import couldn't be re-imported under another owner | Likely covered by [#3091](https://github.com/CapSoftware/Cap/pull/3091) and [#2331](https://github.com/CapSoftware/Cap/pull/2331) | Verify on our instance before doing anything |
| 9 | Skip Pro upsell onboarding steps when self-hosted | Self-hosted users already have every Pro feature | Nothing open | PR. Small. |
| 10a | `CAP_CHROME_EXTENSION_ID` in compose files | Extension login fails without it | Issue [#1993](https://github.com/CapSoftware/Cap/issues/1993) open. Pull requests [#1992](https://github.com/CapSoftware/Cap/pull/1992) and [#2035](https://github.com/CapSoftware/Cap/pull/2035) were closed as stale or duplicate, and the docs mention it since [#3521](https://github.com/CapSoftware/Cap/pull/3521). | One fresh PR against current `main` that credits #1992. First PR: lowest risk. |
| 10b | S3 checksum mode for non-AWS endpoints (R2) | R2 rejects presigned URLs carrying `x-amz-checksum-mode` | No code handles it. Related R2 issues: [#1684](https://github.com/CapSoftware/Cap/issues/1684), [#2384](https://github.com/CapSoftware/Cap/issues/2384). | PR with a repro |

Related upstream threads worth following:

- [#2384](https://github.com/CapSoftware/Cap/issues/2384): the official `cap-web` image is built by hand (`workflow_dispatch`), with gaps of up to two months (2026-09-07 to 2026-11-04).
- [#1996](https://github.com/CapSoftware/Cap/issues/1996): the compose files don't pass AI provider keys yet ([#2036](https://github.com/CapSoftware/Cap/pull/2036) closed as stale). It matters when we turn on transcription.
- [#3881](https://github.com/CapSoftware/Cap/pull/3881) (imports over 5 GB in parts) and [#3824](https://github.com/CapSoftware/Cap/pull/3824) (S3 signing without CloudFront): open fixes that affect our setup.

## Still to set up

Phase 0 (sync, CI, image build, deploys frozen): [smg/plans/2026-11-08-fork-workflow-phase-0.md](smg/plans/2026-11-08-fork-workflow-phase-0.md).
