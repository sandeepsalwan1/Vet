---
summary: "Terse, source-backed documentation and scoped-agent guidance for Vet."
read_when:
  - Adding, deleting, or reorganizing documentation
  - Changing scoped agent instructions or ADRs
---

# Agentic engineering

- Run `npm run docs:list` to discover relevant docs; maintain `summary` and `read_when`. Run `npm run docs:check` after edits.
- Scoped `AGENTS.md` files protect local invariants; avoid parent-rule repetition and file inventories. Root `AGENTS.md` is frozen for this documentation effort.
- Keep architecture, contracts and runbooks current. Source and live behavior own volatile implementation details.
- Keep plans, handoffs and generated proof in ignored local state. Delete superseded drafts instead of archiving them in-repo.
- Preserve explicitly requested source records verbatim and keep assistant interpretation separate. Summarize correspondence when requested.
- Keep ADRs terse: title, status, decision and necessary source links. Original transcripts belong in source docs. Unresolved proposals are not accepted decisions.
- For new features, follow [ADR 0001](adr/0001-new-features.v1.md): cite the customer's exact problem and work backwards from it.
- Use plain dashes in authored text; preserve original source punctuation and whitespace.

## Imported skills

These skills from [davidondrej/skills](https://github.com/davidondrej/skills) keep complete upstream files, MIT licenses and pinned provenance in each `ORIGIN.md`. `.agents/skills` serves Codex and Pi; `.claude/skills` links to it for Claude Code.

- ADRs: [ADR Verbatim](../.agents/skills/adr-verbatim/SKILL.md), [Read All ADRs](../.agents/skills/read-all-adrs/SKILL.md), [Decisions](../.agents/skills/decisions/SKILL.md), [Ask Then Build](../.agents/skills/ask-then-build/SKILL.md), [4x4](../.agents/skills/4x4/SKILL.md).
- Scope and risk: [Before Building](../.agents/skills/before-building/SKILL.md), [Stop Overthinking](../.agents/skills/stop-overthinking/SKILL.md), [Risky Changes](../.agents/skills/risky-changes/SKILL.md).
- Long runs: [Handoff](../.agents/skills/handoff/SKILL.md), [Goal Loop](../.agents/skills/goal-loop/SKILL.md), [Anti-Sleep](../.agents/skills/anti-sleep/SKILL.md).

Use ADR Verbatim only when explicitly requested; the current user instruction overrides its generic ADR trigger. Project ADRs override upstream skill defaults. Anti-Sleep keeps a Mac awake for a bounded time; check for an active `caffeinate` assertion before starting another.

## References

The documentation approach was informed by the July 10, 2026 source audit: [OpenClaw guidance](https://github.com/openclaw/openclaw/blob/2f9cb9200669fe5df86fd229b445685e9b1b81b1/AGENTS.md), its [docs selector](https://github.com/openclaw/openclaw/blob/2f9cb9200669fe5df86fd229b445685e9b1b81b1/scripts/docs-list.js), and [agent-scripts](https://github.com/steipete/agent-scripts/tree/4b81ea73571c). Adopt useful mechanisms, not repository debris.
