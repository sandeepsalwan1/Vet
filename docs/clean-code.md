---
summary: "Clean code rules for writing and reviewing Vet code."
read_when:
  - Writing, refactoring, or reviewing code
---

# Clean code

Original guidance informed by Robert C. Martin's *Clean Code* (2008). The book is copyrighted and not stored here; use a licensed copy for depth. [ADR 0007](adr/0007-agent-friendly-clean-code.md) makes this the default.

- Names say what code does. Rename instead of explaining.
- No comments. Show intent through names, types, and small functions.
- One function does one job at one level of detail.
- Each rule lives in one place. Remove duplication; `npm run lint:duplicates` checks it.
- Delete dead code; `npm run lint:dead` finds it and Git keeps history.
- Fail loudly at boundaries. Never swallow errors.
- Pass dependencies explicitly. Avoid hidden global state.
- Build only what the problem needs, per [ADR 0005](adr/0005-do-not-overengineer.md).
- Test behavior through real paths. Keep tests fast and deterministic.
- Keep files small and predictable, with typed interfaces and clear errors, so agents and people find and change them safely.
- Leave every touched file cleaner than you found it.
