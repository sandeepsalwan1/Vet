# AGENTS.md

GitHub Actions workflows.

## Rules

- Keep baseline CI separate from agent workflows.
- Use `agent-router.yml` for label events and blocked-issue owner replies; specialized `agent-*` workflows stay reusable/manual.
- Treat issue `agent:implement` as the one-label entry point. Write a deterministic zero-model intent seal first; only that managed seal may dispatch implementation.
- The AFK issue form and a manually added `agent:implement` label must behave identically.
- Resolve routine ambiguity with repository context and reasonable defaults. Stop only for real security, authorization, destructive-data, irreversible product-policy, missing-proof, or exhausted-gate decisions.
- An owner reply to a trusted blocked-issue question resumes deterministic triage once. Freeze it as visibly untrusted implementation context; ignore bots, non-owners, stale replies, pull-request comments, and duplicates.
- Agent prompts must read root/applicable nested `AGENTS.md` files and any repository plan linked by the issue.
- Required UI/GIF proof uses Crabbox and records the actual provider and lease.
- Do not expose OpenAI keys as job-level env vars. Pass them only to `openai/codex-action`.
- Keep write-token jobs separate from Codex/API-key jobs.
- Do not fake no-mistakes success; normal automerge requires a real status.
- `priority:trivial` may omit no-mistakes only when sealed before model execution, preserved in immutable PR commit ancestry, and still present on the source issue and PR; CI and review remain required.
- After a trusted agent merge, explicitly dispatch baseline CI and CodeQL against the immutable merge commit.
