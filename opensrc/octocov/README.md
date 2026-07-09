# octocov

Source: https://github.com/k1LoW/octocov

Fetched for planning:

```sh
npx opensrc fetch https://github.com/k1LoW/octocov
```

Local cache:

```text
/Users/sandeep/.opensrc/repos/github.com/k1LoW/octocov/main
```

Current checked state on 2026-07-09:

- latest release: `v0.75.9`
- latest release time: `2026-07-08T06:36:29Z`
- upstream last pushed: `2026-07-08T06:13:21Z`
- public stars at check time: 489
- license: MIT

Use in this repo:

- light CI telemetry after baseline checks
- GitHub Actions job summaries
- PR comments for same-repo PRs
- code-to-test ratio for repo-owned TypeScript/TSX
- future coverage reporting once this repo has a real coverage command

Do not use it for:

- core AFK issue orchestration
- automerge decisions until metrics are stable
- blocking coverage thresholds before `coverage/lcov.info` exists
- replacing CI, no-mistakes, or Crabbox proof

Important constraints:

- octocov supports multiple coverage report formats.
- LCOV default path is `coverage/lcov.info`.
- This repo currently has scenario tests but no coverage-producing script.
- Start with summary/report-only config; promote coverage to blocking only after a real `npm run test:coverage` exists and baseline data is trustworthy.

Do not vendor the full octocov source here. Refresh with `npx opensrc fetch` and cite this note when implementation decisions depend on octocov behavior.
