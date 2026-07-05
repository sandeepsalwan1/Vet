# AGENTS.md

Database migrations.

## Rules

- Append-only numbered SQL: `NNN_short_name.sql`.
- Never edit shipped migrations unless explicitly repairing local-only work before release.
- Scope tenant-owned rows by `clinic_id`.
- Include idempotent seed/repair SQL where reruns are expected.
- Run `npm run db:migrate` against the intended database after migration changes.
