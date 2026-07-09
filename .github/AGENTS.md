# AGENTS.md

GitHub Actions workflows.

## Rules

- Keep baseline CI separate from agent workflows.
- Use `agent-router.yml` for label events; specialized `agent-*` workflows stay reusable/manual.
- Do not expose OpenAI keys as job-level env vars. Pass them only to `openai/codex-action`.
- Keep write-token jobs separate from Codex/API-key jobs.
- Do not fake no-mistakes success; automerge must require a real status.
