# AGENTS.md

Append-only database migrations.

## Rules

- Add a new numbered migration for schema or seed changes.
- Do not edit historical migrations unless explicitly repairing unreleased local work.
- Keep tenant-owned data scoped by `clinic_id`.
- Make repair/seed SQL idempotent when reruns are expected.
- Run `npm run db:migrate` against the intended database after migration changes.
