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

Current checked state on 2026-07-09:

- latest upstream release: `v0.36.0`
- latest release time: `2026-07-05T13:57:59Z`
- upstream last pushed: `2026-07-09T14:37:08Z`
- public stars at check time: 1109
- local binary: `/Users/sandeep/bin/crabbox`
- local version: `0.36.0-20-g9458be48`
- local source checkout: `/Users/sandeep/projects/crabbox`
- source state: `v0.36.0-20-g9458be48`
- status: updated from upstream and rebuilt with release-style version ldflags
- doctor: tools OK; provider check fails because `HCLOUD_TOKEN` or `HETZNER_TOKEN` is missing
- license: MIT

Implementation notes:

- report actual provider and lease id for every remote run
- the issue "brain" is the `.agent` worker and configured agent backend running inside Crabbox, not the raw Crabbox binary alone
- use `--timing-json` where supported for cost/runtime tracking
- use desktop/browser providers only for explicit UI proof or GIF requests
- collect artifacts through Crabbox artifact commands instead of ad hoc uploads

Do not vendor the full Crabbox source here. Refresh with `npx opensrc fetch` and cite this note when implementation decisions depend on Crabbox behavior.
