# AGENTS.md

Postgres data package.

## Shape

- `connection.ts`: `postgres` connection and missing-URL error.
- `clinics.ts`: tenant/host resolution.
- `clinicRows.ts`: clinic row projection.
- `*Rows.ts`: row-to-contract projection modules.
- `task*.ts`: task persistence, audit, transition modules.
- `mockClinic*.ts`: mock clinic projections and mutations.
- `agent*.ts`: agent run, memory, timeline, and decision persistence.

## Rules

- Use parameterized `postgres` template queries.
- Resolve clinic scope before tenant-owned reads/writes.
- Keep row mapping in projection modules, not route files.
- Export public package surface from `src/index.ts`.
- Do not introduce an ORM.
