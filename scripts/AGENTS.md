# Operational Scripts

- Use `scripts/with-root-env.mjs` when a script needs root `.env.local`.
- Keep scripts idempotent where practical and prefer flags over edited constants.
- Print concise proof summaries, never secrets.
- Send passcodes in headers or bodies, never query strings.
- Keep smoke/proof output aligned with maintained docs.
- GitHub-mutating agent automation paths must honor `--dry-run`; workflow-facing CLIs emit `--json`.
- Agent GitHub comments use managed markers and temporary body files.
- `docs-list.mjs` owns content-doc discovery and metadata checks; it excludes scoped `AGENTS.md` files.
- `smoke-local.mjs` warms pages/routes before enforcing measured budgets.
- Scenario data and assertion policy stay separate from HTTP execution.
