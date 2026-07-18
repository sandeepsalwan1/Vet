# Database Migrations

- Add append-only numbered SQL as `NNN_short_name.sql`.
- Never edit a shipped migration unless explicitly repairing unreleased local work.
- Scope tenant-owned rows by `clinic_id`.
- Make seed and repair SQL idempotent when reruns are expected.
- Keep secrets, provider ids, and private operational data out of migrations.
- Run `npm run db:migrate` against the intended database after migration changes.
