# AGENTS.md

GitHub Actions workflows.

## Rules

- Keep baseline CI separate from agent workflows.
- Use `agent-router.yml` for label events; specialized `agent-*` workflows stay reusable/manual.
- Treat issue `agent:implement` as the one-label entry point. Run trusted cheap triage first; only managed triage may dispatch implementation.
- The AFK issue form and a manually added `agent:implement` label must behave identically.
- After trusted triage, continue without owner presence. Stop only for real risk, ambiguity, proof, or gate failures.
- Agent prompts must read root/applicable nested `AGENTS.md` files and any repository plan linked by the issue.
- Required UI/GIF proof uses Crabbox and records the actual provider and lease.
- Do not expose OpenAI keys as job-level env vars. Pass them only to `openai/codex-action`.
- Keep write-token jobs separate from Codex/API-key jobs.
- Do not fake no-mistakes success; automerge must require a real status.
- After a trusted agent merge, explicitly dispatch baseline CI and CodeQL against the immutable merge commit.
