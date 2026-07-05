# AGENTS.md

Client request package.

## Shape

- `clientRequestValidation.ts`: public request schema and field validation.
- `clientRequestGuard.ts`: rate-limit, duplicate detection, guard-event writes.
- `clientRequestLogger.ts`: structured request logging.
- `index.ts`: task-creation interface.

## Rules

- `/request` UI lives in `apps/internal`.
- Keep guard, validation, and persistence orchestration behind this package interface.
- Hash client/request identifiers in logs.
- Preserve field-error shape consumed by `RequestForm`.
