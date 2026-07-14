# Crabbox

Source: https://github.com/openclaw/crabbox

Fetched for planning:

```sh
npx opensrc fetch https://github.com/openclaw/crabbox
```

Local cache:

```text
/Users/sandeep/.opensrc/repos/github.com/openclaw/crabbox/main
```

Use in this repo:

- OpenClaw's `openclaw/crabbox` repository is the execution-host reference implementation
- default remote worker host when provider auth exists
- remote agent execution and proof runs
- desktop/browser proof when explicitly requested
- GIF/video proof only when issue or PR asks for it
- provider comparison for cheapest runner selection

Current planned provider policy:

- GitHub Actions first for normal CI and label orchestration.
- Crabbox non-visual provider for short remote runs when auth exists.
- Crabbox `hetzner` for desktop/browser/GIF proof when auth exists.
- Current Vercel token exists but is not authorized by `vercel whoami`; do not treat Vercel Sandbox as verified yet.
- Current Hetzner-compatible token is missing; desktop/browser/GIF proof is blocked until `HCLOUD_TOKEN` or `HETZNER_TOKEN` exists.

Current checked state on 2026-07-13:

- latest upstream release: `v0.38.0`
- latest release time: `2026-07-11T22:30:33Z`
- local binary: `/Users/sandeep/bin/crabbox`
- local version: `0.38.0-5-g46f19a44`
- local source checkout: `/Users/sandeep/projects/crabbox`
- source state: `v0.38.0-5-g46f19a44`
- status: updated from upstream and rebuilt with release-style version ldflags
- doctor: tools OK; provider check fails because `HCLOUD_TOKEN` or `HETZNER_TOKEN` is missing
- Vercel Sandbox smoke: environment-blocked by HTTP 403 account scope before lease acquisition
- license: MIT

Implementation notes:

- report actual provider and lease id for every remote run
- the issue "brain" is the `.agent` worker and configured agent backend running inside Crabbox, not the raw Crabbox binary alone
- use `--timing-json` where supported for cost/runtime tracking
- set `CRABBOX_VERCEL_READY` or `CRABBOX_HETZNER_READY` as a repository variable only after that provider passes a live smoke
- use desktop/browser providers only for explicit UI proof or GIF requests
- collect artifacts through Crabbox artifact commands instead of ad hoc uploads

Do not vendor the full Crabbox source here. Refresh with `npx opensrc fetch` and cite this note when implementation decisions depend on Crabbox behavior.
