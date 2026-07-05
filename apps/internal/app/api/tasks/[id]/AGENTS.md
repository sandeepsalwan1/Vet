# AGENTS.md

Task mutation route modules.

## Rules

- `route.ts` resolves the dynamic task id and delegates PATCH handling.
- `_taskUpdateRequest.ts` owns actor auth, payload validation, workflow checks, persistence, escalation notification trigger, logging, and projection.
- `undo/route.ts` resolves the dynamic task id and delegates undo handling.
- `undo/_taskUndoRequest.ts` owns manager auth, undo persistence, logging, and projection.
- Return task data through `../_taskVisibility.ts`.
