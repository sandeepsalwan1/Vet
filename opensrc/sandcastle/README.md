# Sandcastle

Source: https://github.com/mattpocock/sandcastle

Fetched for planning:

```sh
npx opensrc fetch https://github.com/mattpocock/sandcastle
```

Local cache:

```text
/Users/sandeep/.opensrc/repos/github.com/mattpocock/sandcastle/main
```

Current checked state on 2026-07-16:

- latest release: `v0.12.0`
- latest release time: `2026-06-29T20:16:27Z`
- upstream last pushed: `2026-06-29T20:16:27Z`
- checked commit: `e99f832f26dc9d245c019a9ddd19fa5dee792427`
- language: TypeScript
- license: MIT
- stars at check time: 6858

Use in this repo:

- reference implementation for label-driven AFK issue and PR automation
- label-filtered issues as the worker's bounded source of truth
- one issue per iteration with a dedicated branch and separate implement/review phases
- examples for `agent:implement`, `agent:review`, `agent:blocked`, branch updates, label-triggered assignment, and safe transitions
- optional TypeScript orchestration adapter for AFK implementation/review runs
- useful when raw GitHub Actions scripts become awkward for multi-agent planning, parallel execution, branch strategies, review pipelines, or session capture/resume
- supports Codex as an agent provider
- supports Docker, Podman, Vercel, custom sandbox providers, and no-sandbox mode
- Vercel adapter can rely on `VERCEL_TOKEN` or `VERCEL_OIDC_TOKEN`
- has templates relevant to this goal:
  - `simple-loop`
  - `sequential-reviewer`
  - `parallel-planner`
  - `parallel-planner-with-review`

Do not use it for:

- copying upstream workflows without adapting this repo's labels, gates, and trust boundaries
- final merge gate
- no-mistakes replacement
- Crabbox desktop/browser/GIF proof replacement
- bypassing branch protection or required checks

Recommendation:

- Keep GitHub Issues and Actions as the control plane, using Sandcastle's repository as the AFK label-workflow reference.
- Keep this repo's smaller state machine and trusted gate scripts instead of taking the upstream workflows wholesale.
- Use Crabbox as the preferred remote worker host when provider auth exists.
- Add Sandcastle only inside the worker if the implementation runner benefits from TypeScript orchestration, parallel issue planning, branch strategies, warm sandbox reuse, structured output, or session handling.
- If Sandcastle uses Vercel Sandbox, first verify with a real sandbox create/run smoke. The current `VERCEL_TOKEN` exists and may be new, but `vercel whoami --token "$VERCEL_TOKEN"` is unauthorized.

Do not vendor the full Sandcastle source here. Refresh with `npx opensrc fetch` and cite this note when implementation decisions depend on Sandcastle behavior.
