# AGENTS.md

Vet: one deployed Next.js app, Postgres-backed npm workspace.

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
- `.agents/skills` and `.claude/skills`: project-local agent skills; keep secrets out.

## Commands

- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Dead code: `npm run lint:dead`
- Duplicates: `npm run lint:duplicates`
- Open-source cache: `npm run opensrc:sync`
- Scenarios: `npm run test:scenarios`
- Local smoke: `npm run smoke:local` with dev server running.

## AFK Issue Automation

- AFK redesign intent, failure evidence, pipeline, and acceptance contract: `.agent/AFK-AUTOMATION-INTENT.md`; read before changing automation.
- Crabbox is the worker environment; `.agents/skills` supplies the Vet worker plus selected review, Render, and database skills.
- Crabbox workers act proactively: pursue the complete sealed outcome, use relevant skills, repair failures, and verify the real result without waiting for routine direction.
- AFK scope covers valid Vet code, UI, test, data, proof, GitHub, and configured-service work; route each request to the least-privileged capable lane and relevant project skills.
- Prefer ChatGPT-managed Codex automation auth when a supported scoped access token exists.
  Never copy personal Codex `auth.json` into GitHub Actions or a Crabbox lease.
- New work: open `https://github.com/sandeepsalwan1/Vet/issues/new?template=afk-implementation.yml`; submission adds `agent:implement` automatically.
- Existing issue: run `gh issue edit <number> --repo sandeepsalwan1/Vet --add-label agent:implement`.
- Then leave it alone; automation records a zero-model intent seal, creates its branch and draft PR, runs CI, review, and no-mistakes, then safely merges and closes the issue.
- Trivial low-risk cost lane: add `priority:trivial` before `agent:implement`; it skips paid no-mistakes only, while CI and review remain required.
- One-head owner bypass: run `Agent Skip no-mistakes` with the exact PR head SHA; CI, review, proof, and merge policy remain required.
- No manual branch or push is required.
- Intentional manual bypass: a repository-owner direct push is outside the AFK loop; `[skip ci]` also skips push-triggered Actions.
- Return only when `agent:blocked` requests a decision, or `agent:proof-failed` remains after automatic recovery stops.
- Failure lesson: missing exact-main checks plus stale readiness need one deduplicated exact-head recovery before model spend; explicit proofless or CI-only wording defeats keyword-only media or service escalation unless positive evidence overrides it.
- Failure lesson: do not run `typecheck` and `build` concurrently in one checkout; both touch `.next/types` and can create transient route-validator failures.
- Failure lesson: if no-mistakes self-update returns HTTP 403, use an authenticated checksum-verified release download, then require doctor and AXI success after daemon restart.
- Failure lesson: Vercel delegated output can report remote success then lose the final stream; retry once only for the exact SDK early-stream signature and still require the sealed handoff marker.
- Failure lesson: repeated early-stream loss on larger agent output needs digest-bound bounded handoff records, not more paid retries; retain the legacy reader during migration.
- Failure lesson: resealing an implemented issue can leave its bot branch divergent; replace only a bot-authored same-issue prior intent from the new validated base with an exact force-with-lease.
- Full operation, recovery, and exact-head approval steps: `docs/agent-automation.md`.

## Architecture Rules

- Use `CONTEXT.md` names for domain concepts.
- Keep HTTP routes shallow; put behavior in package/app modules with typed interfaces.
- Do not re-add `apps/client-request`, `packages/request-form`, or `packages/request-intake`; `/request` lives in `apps/internal`.
- Keep Google ADK runtime imports behind `@central-vet/agents/adk-runtime`.
- Root `package.json` overrides patch ADK transitive security advisories; rerun `npm audit --omit=dev` after dependency updates.
- Dependency holds: keep `@google/adk` on v1.3 and `@google/genai` on v1 until the ADK v1.4 GenAI v2 migration; keep ESLint on v9 until Next/react lint stack supports v10; keep `@types/node` aligned with the minimum supported Node engine.
- New shared behavior belongs in a package only when two callers need the seam.
- Agent cost: use the cheapest model that reliably satisfies each lane contract; increase model or reasoning only after measured failure.
- Treat clinic branding, messaging cadence/channels, and PIMS provider as tenant configuration; Tri-City is the current design-partner profile, not a product-wide hardcode.
- `centralvet.eepish.com` is Central Veterinary Hospital; `tricityvet.eepish.com` is Tri-City Veterinary Hospital. Never alias, merge, or share branding or data between them.
- Build for a real product, not a demo; mock and local proof paths must remain replaceable by tenant-scoped Cornerstone, AVImark, or other PIMS adapters.
- No secrets in docs, logs, tests, screenshots, or proof files.

## Docs

- Keep active docs flat in `docs/`.
- Delete stale plans/handoffs instead of archiving them in-repo.
- Update `README.md`, `CONTEXT.md`, and the nearest `AGENTS.md` when architecture changes.
- Keep `docs/architecture.md` aligned with major module/interface changes.
- Prefer terse, current notes over historical narration.
