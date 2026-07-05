# AGENTS.md

Task route modules.

## Rules

- Routes are HTTP adapters; validation and workflow checks live in `_taskCreateRequest.ts` or `_taskUpdateRequest.ts`.
- `_taskListRequest.ts` owns task list auth, query parsing, archive cutoff, no-store response, and task listing.
- `_taskVisibility.ts` owns role-specific task projection for task reads/writes.
- Resolve clinic and actor before task reads/writes.
- Keep status/action rules aligned with `apps/internal/app/lib/taskWorkflow.ts`.
- Persist task writes through `@central-vet/db`.
- Add regression proof when changing archive, undo, escalation, duplicate, or rate-limit behavior.
