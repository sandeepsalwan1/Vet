# no-mistakes

Source: https://github.com/kunchenguid/no-mistakes

Fetched for planning:

```sh
npx opensrc fetch https://github.com/kunchenguid/no-mistakes
```

Local cache:

```text
/Users/sandeep/.opensrc/repos/github.com/kunchenguid/no-mistakes/main
```

Current checked state on 2026-07-09:

- latest stable release: `v1.34.0`
- latest stable release time: `2026-07-07T06:30:53Z`
- upstream last pushed: `2026-07-09T00:15:03Z`
- public stars at check time: 5664
- local binary: `/Users/sandeep/.local/bin/no-mistakes`
- local version checked on 2026-07-08: `v1.31.2`
- action needed: upgrade local no-mistakes before live gates
- Vet repo status: initialized with a `no-mistakes` remote
- daemon: running
- local agent backends detected: `codex`, `claude`
- license: MIT

Use in this repo:

- final validation gate for agent-created implementation branches
- review/test/lint/docs/CI gate after the reviewer agent finishes
- required pre-merge signal before low/medium-risk automerge
- mandatory for every agent-created implementation PR; no passing no-mistakes gate means no automerge

Important constraints:

- initialize per repo with `no-mistakes init`
- rerun `no-mistakes init` after upgrading to refresh gate wiring and installed skill text
- run from a committed feature branch, not directly on `main`
- treat `ask-user` findings as manual blockers unless the user explicitly approves auto-resolution
- high-priority/high-risk PRs still require human review even if no-mistakes passes

Do not vendor the full no-mistakes source here. Refresh with `npx opensrc fetch` and cite this note when implementation decisions depend on no-mistakes behavior.
