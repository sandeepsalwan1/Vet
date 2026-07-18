---
summary: "Render and Supabase deployment shape, environment policy, cron behavior, and proof."
read_when:
  - Deploying or changing Render, Supabase, cron, or notification configuration
  - Adding an environment variable or migration requirement
  - Verifying production-like behavior
---

# Deployment

`render.yaml` is the source of truth for hosted service shape and environment keys. Keep provider resource ids, account ids, workspace ids, tickets, personal contacts, and secret values out of source docs.

## Shape

- One Render web service builds and runs `apps/internal`.
- The free web service runs idempotent database migrations inside its build command because Render pre-deploy commands require a paid web service.
- Supabase Postgres is accessed through `DATABASE_URL`.
- App-layer tenant resolution and `clinic_id` scoping protect tenant data; do not enable RLS without complete policies.
- Passcode auth remains the current staff authentication contract.
- Render cron services call notification routes with bearer authorization.
- Cron services use Render's minimum paid plan; do not sync or create them without explicit billing approval.
- Generated proof stays outside `docs/`.

## Commands

- Install: `npm ci`
- Build: `npm run build --workspace @central-vet/internal`
- Start: `npm run start --workspace @central-vet/internal -- -p $PORT`
- Migrate: `npm run db:migrate`
- Provision clinic: `npm run clinic:provision -- --slug <clinic-slug> --name <clinic-name> --host <clinic-host>`

Migrations are append-only under `db/migrations`. The database client disables prepared statements for Supabase transaction-pooler compatibility.

## Environment Policy

`render.yaml` distinguishes configured defaults from `sync: false` secrets. Main groups are:

- database and Supabase connectivity
- hospital identity, timezone, mock mode, and agent runtime
- staff passcodes
- optional Google, E2B, and Apify tools
- notification mode, Resend email transport, Twilio SMS transport, sender, and recipient configuration
- cron authorization and internal base URL

Keep live notification modes disabled until approved. Use test recipients for smoke proof. Cron routes require `Authorization: Bearer $CRON_SECRET` outside development.

## Cron

- Daily priority summary calls `/api/notifications/daily-priority-summary` and honors the Admin end-of-day toggle.
- Monthly agent email calls `/api/notifications/monthly-agent-email` and uses a month-scoped idempotency key.
- Client journey delivery calls `/api/notifications/client-journey`, dispatches due idempotent plans, and rechecks current channel consent before transport.
- Preserve the existing Render service names when changing the blueprint so sync updates rather than duplicates services.

## CI

`.github/workflows/ci.yml` runs quality, build, deterministic scenarios, production-dependency audit, dependency review on pull requests, and non-blocking octocov reporting. Render auto-deploys the configured branch; CI does not contain a separate deployment or migration job.

## Proof

Before deployment:

    npm run typecheck
    npm run lint
    npm run lint:dead
    npm run lint:duplicates
    npm run test:scenarios
    npm run build
    npm audit --omit=dev

With a reachable app:

    LOCAL_BASE_URL=http://localhost:3000 npm run verify:agents
    LOCAL_BASE_URL=http://localhost:3000 npm run verify:agents:google
    npm run smoke:agent-email -- --base-url http://localhost:3000
    SCENARIO_BASE_URL=<deployed-url> npm run scenarios:e2b

Manual cron proof calls each notification route with the configured bearer secret and verifies a successful, non-secret response.
