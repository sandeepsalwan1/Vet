# AGENTS.md

Central Veterinary Hospital MVP: one deployed Next.js app, Postgres-backed npm workspace.

## Repo Map

- `apps/internal`: public flows, staff task board, agent routes.
- `packages/agents`: deterministic and Google ADK-backed workflow modules.
- `packages/db`: Postgres schema helpers, row projections, tenant-scoped queries.
- `packages/notifications`: email/SMS notification planning and send pipeline.
- `packages/client-request`: public request guard, validation, logging, task creation.
- `db/migrations`: append-only SQL migrations.
- `docs`: active docs; generated proof is local-only.
- `opensrc`: upstream mirrors/provenance notes that support package decisions.
- `scripts`: local smoke, proof, migration, provisioning helpers.
- `skills` and `.claude/skills`: project-local agent skills; keep secrets out.

## Commands

- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Dead code: `npm run lint:dead`
- Duplicates: `npm run lint:duplicates`
- Scenarios: `npm run test:scenarios`
- Local smoke: `npm run smoke:local` with dev server running.

## Architecture Rules

- Use `CONTEXT.md` names for domain concepts.
- Keep HTTP routes shallow; put behavior in package/app modules with typed interfaces.
- Do not re-add `apps/client-request`, `packages/request-form`, or `packages/request-intake`; `/request` lives in `apps/internal`.
- Keep Google ADK runtime imports behind `@central-vet/agents/adk-runtime`.
- Root `package.json` overrides patch ADK transitive security advisories; rerun `npm audit --omit=dev` after dependency updates.
- Dependency holds: keep `@google/genai` on v1 while `@google/adk` depends on v1; keep ESLint on v9 until Next/react lint stack supports v10; keep `@types/node` aligned with the minimum supported Node engine.
- New shared behavior belongs in a package only when two callers need the seam.
- No secrets in docs, logs, tests, screenshots, or proof files.

## Docs

- Keep active docs flat in `docs/`.
- Delete stale plans/handoffs instead of archiving them in-repo.
- Update `README.md`, `CONTEXT.md`, and the nearest `AGENTS.md` when architecture changes.
- Keep `docs/architecture.md` aligned with major module/interface changes.
- Prefer terse, current notes over historical narration.
