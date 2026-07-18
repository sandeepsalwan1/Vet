# VetAgent / Central Veterinary Hospital MVP

https://vetagent-internal.onrender.com

One deployed Render app in an npm workspace monorepo, backed by Supabase Postgres.

- `apps/internal`: unified public client flows, staff task board, and agent routes.
- `packages/agents`: agent runtimes, tool registry, and domain tool groups.
- `packages/db`: Postgres schema and server helpers.
- `packages/notifications`: Resend email and email-to-SMS notification helpers.
- `packages/client-request`: shared public request guard, validation, dedupe, and task creation.
- `opensrc`: upstream mirror/provenance notes for dependencies that need source inspection.
- `.agent` and `.github/workflows/agent-*`: issue-label automation config, prompts, and workflows.
- `skills` and `.claude/skills`: project-local agent launch/scraping skills.

Docs:

- Run `npm run docs:list` to find maintained docs by purpose and task.
- Start with `docs/architecture.md` for system boundaries and `docs/deployment.md` for operations.
- Coding-agent policy lives in `AGENTS.md`; scoped guides add only subtree-specific rules.

Local commands:

- `npm install`
- `cp .env.example .env.local` and fill Supabase `DATABASE_URL`
- `npm run db:migrate`
- `npm run dev`
- `npm run lint`, `npm run typecheck`, `npm run lint:dead`, and `npm run lint:duplicates` for source health checks. Duplication ignores append-only DB migrations.
- `npm run test:client-journey` for welcome, appointment, consent, checkout, and follow-up messaging policy.
- `npm run smoke:local` while the dev server is running to warm local pages/routes, then verify core agent route response-time budgets.
- `npm run smoke:agent-email -- --base-url http://localhost:3000` while the app is running to verify monthly email idempotency through `/api/agent/email` without sending live email.
- `npm run scenarios:local` while the dev server is running to exercise semantic agent scenarios against local routes.
- `npm run verify:agents` while a local server is running to append fallback-safe local proof to `$TMPDIR/central-vet-agent-proof.md`; set `VERIFY_AGENTS_PROOF_PATH` for another file.
- `npm run verify:agents:google` while a server started with `AGENT_RUNTIME=google-adk` is running to require live Google ADK credentials and proof.
- `npm run smoke:e2b` to verify the configured E2B key can start a sandbox.
- `npm run scenarios:e2b` to run the scenario harness through E2B when `SCENARIO_BASE_URL` is a public URL; localhost falls back to local scenarios after an E2B readiness check.

Demo accounts:

- Pet owner: `maya@example.com` / `demo1234` (Maya Parker + Biscuit; check-in matches seeded appointment data)
- New-client record claim: `maya.parker@example.com` + `Biscuit` (development shows the verification code; production never does)
- Staff: `staff@centralvet.demo` / `staff1234`
- Veterinarian: `vet@centralvet.demo` / `vet1234` or direct board passcode `135790`
- Admin: `admin@centralvet.demo` / `admin1234` or direct board passcode `246810`
- Disable built-in demo passcodes with `DEMO_ACCOUNTS=disabled`; rejected manager account sessions fall back to the passcode board.

Agent runtime:

- Demo-safe default: `AGENT_RUNTIME=mock`.
- Live target: Google ADK TypeScript through `AGENT_RUNTIME=google-adk`.
- Missing live credentials fall back to deterministic runtime with a `runtime_fallback` event.
- E2B is for sandboxed proof/evals, not normal request paths.
- See `docs/agent-architecture.md`.

Dependency holds:

- Keep `@google/genai` on v1 while `@google/adk` depends on v1.
- Keep ESLint on v9 until the Next/react lint stack supports v10.
- Keep `@types/node` on the repo's supported Node engine line.

Render + Supabase:

- One Render web service from `render.yaml`.
- Supabase Postgres through `DATABASE_URL`.
- Notification cron routes use `CRON_SECRET`.
- Keep live notifications disabled until approved.
- See `docs/deployment.md`.

Main routes:

- `/arrival`, `/booking`, `/pickup`, `/records`, `/followup`, `/call`, `/request`
- `/staff`, `/staff/agent`, `/staff/approvals`
- `/api/mock/clinic`, `/api/agent/*`, `/api/approvals`, `/api/reports/*`
- `/api/client-account-claim`, `/api/client-journey`, `/api/client-journey/staff`, `/api/notifications/client-journey`
hi this works
