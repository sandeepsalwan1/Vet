# Deployment

Last updated: 2026-07-03

Deployment shape and runbook. Keep provider resource ids, account ids, workspace ids, tickets, and secret values out of source docs.

## Shape

- Deploy one Render web service from `apps/internal`.
- Use Supabase Postgres through `DATABASE_URL`.
- Keep passcode auth; do not add Supabase Auth for the current app.
- Use `render.yaml` as the deploy blueprint.
- Use cron routes for daily priority summary and monthly agent email.
- Keep generated proof outside `docs/` by default.

## Build

- Install: `npm ci`
- Build: `npm run build --workspace @central-vet/internal`
- Start: `npm run start --workspace @central-vet/internal -- -p $PORT`
- Migrate: `npm run db:migrate`
- Clinic provisioning: `npm run clinic:provision -- --slug <clinic-slug> --name <clinic name> --host <clinic-host>`

## Database

- Runtime DB env: `DATABASE_URL`.
- Use the Supabase pooler connection string for hosted Render runtime.
- The repo disables prepared statements for Supabase transaction-pooler compatibility.
- Migrations are append-only under `db/migrations`.
- Current schema expects migrations `001` through `025`.
- Do not enable RLS without policies; server-side flows currently rely on app-layer tenancy and `clinic_id` scoping.

## Render Env

Required web env:

- `DATABASE_URL`
- `HOSPITAL_NAME`
- `APP_TIME_ZONE`
- `MOCK_MODE`
- `AGENT_RUNTIME`
- `VET_ADMIN_PASSCODE`
- `VET_APP_ADMIN_PASSCODE`
- `VET_VETERINARIAN_PASSCODE`
- `CRON_SECRET`

Optional live-tool env:

- `GEMINI_API_KEY` or `GOOGLE_API_KEY`
- `GOOGLE_GENAI_USE_VERTEXAI`
- `GOOGLE_CLOUD_PROJECT`
- `GOOGLE_CLOUD_LOCATION`
- `E2B_API_KEY`
- `APIFY_API_TOKEN`
- `APIFY_PRICING_ACTOR_ID`
- `DEMO_ACCOUNTS=disabled` to reject built-in demo passcodes.

Notification env:

- `NOTIFICATION_MODE`
- `NOTIFICATION_CHANNEL`
- `RESEND_API_KEY`
- `DOCTOR_NOTIFICATION_EMAILS`
- `SMS_NOTIFICATION_RECIPIENTS`
- `TEST_NOTIFICATION_EMAIL`
- `TEST_SMS_NOTIFICATION_RECIPIENTS`
- `MONTHLY_AGENT_EMAIL_MODE`
- `MONTHLY_AGENT_EMAIL_RECIPIENTS`
- `MONTHLY_AGENT_EMAIL_SUBJECT`
- `MONTHLY_AGENT_EMAIL_MESSAGE`

Rules:

- Keep `NOTIFICATION_MODE=disabled` until live sends are approved.
- Use test-only recipients for smoke checks.
- Store doctor profile passcodes and delivery preferences in Admin settings after deployment.
- Cron routes require `Authorization: Bearer $CRON_SECRET` in production.

## Cron

- Daily priority summary calls `GET /api/notifications/daily-priority-summary` and honors the Admin end-of-day alert toggle.
- Render cron service name stays `vetagent-overdue-summary` so blueprint sync updates the existing cron in place.
- Monthly agent email calls `GET /api/notifications/monthly-agent-email`.
- Monthly email uses a local `YYYY-MM` idempotency key, so repeated calls in the same month duplicate-skip.

## Proof

Run before deploy:

- `npm run lint`
- `npm run typecheck`
- `npm run lint:dead`
- `npm run lint:duplicates`
- `npm run test:scenarios`
- `npm run build`
- `npm audit --omit=dev`

Run with a reachable app:

- `LOCAL_BASE_URL=http://localhost:3000 npm run verify:agents`
- `LOCAL_BASE_URL=http://localhost:3000 npm run verify:agents:google`
- `SCENARIO_BASE_URL=<deployed-url> npm run scenarios:e2b`
- `npm run smoke:agent-email -- --base-url http://localhost:3000`

Manual cron proof:

- Call `/api/notifications/daily-priority-summary` with `Authorization: Bearer $CRON_SECRET`.
- Call `/api/notifications/monthly-agent-email` with `Authorization: Bearer $CRON_SECRET`.

## CI

- Pipeline steps: install, typecheck, build, optional migration check, deploy trigger.
- Add manual approval before production deploy when the pipeline supports it.
- Do not block local development on hosted pipeline state; record blockers in the deploy system or an issue.
