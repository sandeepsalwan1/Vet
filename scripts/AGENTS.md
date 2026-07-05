# AGENTS.md

Operational scripts.

## Rules

- Use `scripts/with-root-env.mjs` when a script needs root `.env.local`.
- Keep scripts idempotent where practical.
- Print proof summaries, not secrets.
- Send passcodes in headers/body, never query strings.
- Prefer flags over editing script constants.
- Keep smoke/proof output aligned with docs.
- `smoke-local.mjs` warms pages/routes first, then enforces measured budgets.
- Scenario definitions live in `vetagent-scenario-data.mjs`.
- Scenario assertion/detail policy lives in `vetagent-scenario-assertions.mjs`; `vetagent-scenarios.mjs` owns HTTP execution.
