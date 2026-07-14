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

Current checked state on 2026-07-13:

- latest stable release: `v1.37.0`
- latest stable release time: `2026-07-13T03:12:40Z`
- local binary: `/Users/sandeep/.local/bin/no-mistakes`
- local version: `v1.37.0`
- release archive checksum: verified before installation
- Vet repo status: initialized with a `no-mistakes` remote
- gate: refreshed after upgrade
- doctor: core checks and Codex gate validation pass
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
