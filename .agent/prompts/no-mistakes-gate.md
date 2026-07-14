# no-mistakes Gate Summary

Summarize the no-mistakes gate for one agent-created PR.

Return JSON only. Use `.agent/schemas/gate.schema.json`.

Rules:

- Gate runs only on committed feature branches, never `main`.
- `ask-user` findings block AFK automerge by default; exact-head unattended approval is only allowed when the repository owner explicitly approves that immutable PR head.
- High-priority or high-risk work still requires human review even if the gate passes.
- Do not print secret values.
