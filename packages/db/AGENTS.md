# Postgres Data Boundary

- Use parameterized `postgres` template queries; do not introduce an ORM.
- Every tenant-owned query takes or resolves `clinicId`.
- Keep row-to-contract mapping in `*Rows.ts` projection modules.
- Keep status transitions and audit writes in persistence modules, not routes.
- Keep JSON coercion, redaction, truncation, and depth limits in the shared agent JSON policy.
- Export the public package surface from `src/index.ts`; do not reach through to private modules.
- Keep migrations append-only under `db/migrations`.
