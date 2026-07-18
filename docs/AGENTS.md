# Documentation

- Run `npm run docs:list` before broad documentation or architecture work.
- Maintained content docs require non-empty `summary`; task-specific docs require concrete `read_when` hints.
- `AGENTS.md` files are scoped instruction and stay outside content metadata.
- Keep docs factual and source-backed. Remove superseded behavior instead of adding historical caveats.
- Keep stable architecture, contracts, and runbooks here; put task plans, handoffs, research, and generated proof in ignored local state.
- Keep public docs generic: no credentials, personal account notes, resource ids, named contacts, tickets, or private operational details.
- Update the owning doc when behavior or a public contract changes; do not maintain a manual inventory in this directory.
- Run `npm run docs:check` after changes.
