---
summary: "Evidence-backed documentation and scoped-agent guidance for efficient work in Vet."
read_when:
  - Adding, deleting, or reorganizing documentation
  - Adding or changing a scoped AGENTS.md
  - Deciding whether a plan or implementation note belongs in the repository
---

# Agentic Engineering

This policy comes from a 2026-07-10 source audit of eight recently active Peter Steinberger repositories plus OpenClaw. It records the recurring mechanisms worth adopting, not every habit or historical artifact in those repositories.

## Learnings

### `AGENTS.md` is a constraint surface, not a directory README

Seven of the eight sampled `steipete` repositories had zero or one real `AGENTS.md`. OpenClaw was the scale exception: 22,492 tracked files and 703 docs, but only 22 active guides (24 uppercase paths when a template and test fixture are counted). Its smallest scoped guide is three lines and protects one transcript-corruption invariant.

A scoped guide earns its place only when directory locality protects a sharp rule: authorization, data isolation, generated-source ownership, a model-facing contract, a destructive workflow, or a known regression hazard. File maps, generic style advice, and parent repetition do not qualify.

### Progressive disclosure is the repeatable docs mechanism

OpenClaw, agent-scripts, CodexBar, Oracle, RepoBar, and Summarize all carry nearly the same lightweight docs-list program. It walks `docs/`, reads `summary` and `read_when`, and prints a task router. Agents can discover relevant context without loading an entire docs tree.

Metadata is an optimization, not a universal doctrine. It was prevalent in the larger maintained doc sets but absent from several smaller repositories. Vet keeps it because the selector is cheap and useful, not because every Markdown file needs ceremony.

### Documentation follows supported surfaces

The useful recurring docs describe architecture, configuration, CLI behavior, integrations, release operations, debugging, and verification. They are task-shaped and updated with the behavior they explain. Source, schemas, tests, and live behavior remain authoritative for volatile route names, payload fields, file inventories, and current implementation details.

Repository size does not justify speculative documents. A document should have a present owner, a reader with a concrete task, and facts that remain useful across ordinary refactors.

### Plans are working state unless explicitly promoted

Tracked implementation plans were rare in the sample: one explicit OpenClaw design plan among hundreds of docs and one tool-generated plan area in CodexBar. That makes them exceptions, not the normal documentation model.

Plans, handoffs, research ledgers, transcripts, PR proof, and generated reports stay in ignored local state. After implementation, promote only durable decisions into the owning architecture, operations, or contract doc; delete the task narrative.

### Copy the system, not the repository debris

Some sampled repositories also contain dated investigations, proof reports, PR bodies, TODOs, and old refactor notes. Their presence is not evidence that Vet should reproduce them. The reusable system is routing, locality, source-backed facts, focused validation, and aggressive removal of superseded context.

## Vet Application

- Root `AGENTS.md` is frozen by project policy for this effort.
- `npm run docs:list` routes agents to current durable docs; `npm run docs:check` catches metadata drift.
- Scoped guides stay only where they own a local invariant that would be hard to discover from source or the root guide.
- Architecture docs explain boundaries and flows, not exhaustive route or file catalogs.
- Deployment and automation docs remain because they own operational and security-sensitive workflows.
- Future integrations get a durable doc when an adapter or accepted contract exists, not while they are only an idea.
- Temporary work lives under ignored `.agent/work/`, `docs/.local/`, or another local scratch path.

Delete a doc when its behavior no longer exists, another source owns the same facts, it mainly predicts future implementation, or keeping it accurate requires mirroring code structure.

## Evidence

Primary source snapshots reviewed:

- [OpenClaw root guidance](https://github.com/openclaw/openclaw/blob/2f9cb9200669fe5df86fd229b445685e9b1b81b1/AGENTS.md), [docs guidance](https://github.com/openclaw/openclaw/blob/2f9cb9200669fe5df86fd229b445685e9b1b81b1/docs/AGENTS.md), [docs selector](https://github.com/openclaw/openclaw/blob/2f9cb9200669fe5df86fd229b445685e9b1b81b1/scripts/docs-list.js), and [minimal scoped hazard](https://github.com/openclaw/openclaw/blob/2f9cb9200669fe5df86fd229b445685e9b1b81b1/src/gateway/server-methods/AGENTS.md)
- [agent-scripts](https://github.com/steipete/agent-scripts/tree/4b81ea73571c), [CodexBar](https://github.com/steipete/CodexBar/tree/ce62f4a0de06), [Oracle](https://github.com/steipete/oracle/tree/f3fbc067c9d8), [RepoBar](https://github.com/steipete/RepoBar/tree/5c754564b409), and [Summarize](https://github.com/steipete/summarize/tree/206a6f844764)
- [Birdclaw](https://github.com/steipete/birdclaw/tree/4bc341776d5b), [Poltergeist](https://github.com/steipete/poltergeist/tree/10d1b666fd27), and [macos-automator-mcp](https://github.com/steipete/macos-automator-mcp/tree/84e59bfb3554)
- [Shipping at Inference-Speed](https://steipete.me/posts/2025/shipping-at-inference-speed) and [Just Talk To It](https://steipete.me/posts/just-talk-to-it)
