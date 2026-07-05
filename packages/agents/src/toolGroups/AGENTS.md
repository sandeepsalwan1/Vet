# AGENTS.md

Agent tool group modules.

## Rules

- One domain per file; do not create cross-domain grab bags.
- Tool names are stable contracts; update scenarios when changing them.
- Keep side-effect tools explicit in name, description, and workflow event.
- Use runtime adapters and normalized mock clinic data; do not import app routes.
- Medical, billing, records, and email safety rules fail closed.
- Return structured results that can be redacted and persisted as tool traces.
