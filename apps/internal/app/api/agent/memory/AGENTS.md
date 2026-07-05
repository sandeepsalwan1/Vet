# AGENTS.md

Agent memory route modules.

## Rules

- `route.ts` delegates GET/POST/PATCH/DELETE to `_memoryRequest.ts`.
- `_memoryRequest.ts` owns manager auth, query parsing, memory create/correct/delete validation, actor metadata, DB calls, and HTTP response mapping.
- Keep memory facts bounded and redacted by the DB JSON policy.
- Corrections should create replacement memory rather than mutating the original fact in place.
- Do not store passcodes, tokens, API keys, or raw credentials as memory facts or metadata.
