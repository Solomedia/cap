# SMG fork of Cap

This is Solo Media Group's fork of [CapSoftware/Cap](https://github.com/CapSoftware/Cap), licensed under AGPLv3 like upstream. We run it self-hosted for internal use only. Nothing here is sold or offered as a service.

Our goal is to stay current with upstream and carry as few patches as possible. Every change is built so it can go upstream as a pull request; once upstream merges it, we drop our copy.

## Branches

| Branch | Purpose | Rules |
| --- | --- | --- |
| `main` | Exact mirror of `CapSoftware/Cap:main` | Never commit here. Synced from upstream only. |
| `smg` | `main` + our patches. Production images build from here. | Changes land through PRs from `feat/*`. Rebased on `main` after each upstream sync. |
| `feat/<topic>` | One improvement each | Branched from `main` (not `smg`) so the same branch can open a PR against upstream. |

Flow for every improvement:

1. Branch `feat/<topic>` from an up-to-date `main`.
2. Put new behavior behind an environment variable or a self-hosting check, so upstream's hosted product is unaffected by default.
3. Open the PR against `CapSoftware/Cap:main`, following their conventions (Biome formatting, tests next to the change).
4. Merge the same branch into `smg` so we can use it before upstream reviews it.
5. When upstream merges, delete the patch from `smg` on the next rebase.

## Scope

Only the server side: `apps/web`, `apps/media-server` and shared `packages/*`. The desktop app, CLI and Chrome extension stay on the official builds.

## Improvement roadmap

Found while migrating our Loom workspace to a self-hosted Cap instance.

| # | Improvement | Why | Upstream | Status |
| --- | --- | --- | --- | --- |
| 1 | Loom link lookup: `/loom/<loomId>` resolves to the imported cap, plus a mapping export (Loom URL to Cap URL) | Old `loom.com` links in tickets and PRs stop working once Loom is cancelled; we can't redirect Loom's domain, so we need the mapping to rewrite them | PR | Planned |
| 2 | Org admins can browse members' libraries | Admins can only see their own caps and what is shared with the org | PR (behind a setting) | Planned |
| 3 | Transfer organization ownership | No way to move the owner role today | PR | Planned |
| 4 | `CAP_DISABLE_ORGANIZATION_CREATION` | Self-hosted single-org instances need to stop new orgs (UI, signup and API) | PR | Planned |
| 5 | Hide storage integrations that are not configured | Google Drive "Connect" is enabled without Google credentials and fails | PR | Planned |
| 6 | Loom import reassignment keeps sharing and spaces | Reassigning an imported cap makes it private and removes it from spaces | PR | Planned |
| 7 | Loom import into an organization folder (`--folder`), not only a space | Teams that organize by folders end up with one space per Loom folder | PR | Planned |
| 8 | Retry a failed Loom import with a different owner | A failed import can't be re-imported under another owner | PR | Planned |
| 9 | Skip Pro upsell onboarding steps when self-hosted | Self-hosted users already have every Pro feature | PR | Planned |
| 10 | Self-hosting defaults: `CAP_CHROME_EXTENSION_ID` in compose files, S3 checksum mode for non-AWS endpoints (R2) | Extension login fails without it ([#1993](https://github.com/CapSoftware/Cap/issues/1993)); R2 rejects presigned URLs with checksum mode | PR | Planned |

## Still to set up

- Scheduled sync of `main` from upstream, and a rebase of `smg` that opens an issue on conflict.
- Image build from `smg` to GHCR for our deployment.
- GitHub Actions are disabled by default on forks; enable them when the workflows land.
