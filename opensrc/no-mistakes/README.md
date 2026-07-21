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

Current checked state, refreshed on 2026-07-20:

- latest stable release: `v1.40.0`
- stable release commit: `87a54774a31edb273e35e4269eb0d70c43991060`
- refreshed upstream `main`: `4ba40aee93e80f7e9ee82f510c12eb5d9e26f3ea`
- CI archive checksum: `2445b65179d0e8e9bbf408322f57190f344f9946cfed3971c84fa16ce4122e91`
- Vet CI pin: `v1.40.0`
- local binary: `/Users/sandeep/.local/bin/no-mistakes`
- local version: `v1.37.0`
- local binary state is separate from the pinned CI gate
- Vet repo status: initialized with a `no-mistakes` remote
- local agent backends detected: `codex`, `claude`
- license: MIT

Use in this repo:

- final validation gate for agent-created implementation branches
- authoritative implementation intent through the direct `--intent` argument
- semantic review after trusted exact-head deterministic checks
- two bounded native safe auto-fix rounds in a credential-free isolated worktree
- sealed patch handoff whose digest, paths, base head, and final tree are verified before publication
- fresh exact-head CI, independent review, and no-mistakes after every published native fix
- required pre-merge signal for normal low/medium-risk automerge
- explicit `priority:trivial` exception skips only this paid model gate when the label was sealed before implementation and remains on the issue and PR

Important constraints:

- initialize per repo with `no-mistakes init`
- rerun `no-mistakes init` after upgrading to refresh gate wiring and installed skill text
- run from a committed feature branch, not directly on `main`
- treat `ask-user` findings as manual blockers by default; exact-head unattended approval is only allowed when the repository owner explicitly approves that immutable PR head
- never give the model job GitHub publication credentials; trusted code publishes only a verified non-privileged patch with an exact force-with-lease
- adding `priority:trivial` after implementation starts cannot bypass the gate
- high-priority/high-risk PRs still require human review even if no-mistakes passes

Do not vendor the full no-mistakes source here. Refresh with `npx opensrc fetch` and cite this note when implementation decisions depend on no-mistakes behavior.
