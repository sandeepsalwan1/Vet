# AGENTS.md

Client request implementation modules.

## Rules

- `index.ts` is the package interface for request handling.
- Validation, guard, and logging stay in separate modules behind that interface.
- Hash client/request identifiers before logging or persistence guard writes.
- Preserve `fieldErrors` shape consumed by `apps/internal/app/components/RequestForm.tsx`.
- Do not import UI or route modules into this package.
