# PIMS and Lab Integration

Last updated: 2026-07-03

This doc records the integration shape, not vendor outreach history. Vendor programs, fees, scopes, contacts, and timelines change; reconfirm against official vendor docs before applying.

## Purpose

- PIMS is the clinic system of record for clients, patients, appointments, visits, and record write-backs.
- Lab integration is separate: orders, results, report status, and result context.
- The app should normalize both into VetAgent domain contracts before agents, routes, or UI see vendor-specific shapes.

## Rules

- No screen scraping, shared logins, direct local database access, or unofficial portal automation.
- Start read-only where possible.
- Treat write-back as a staff-approved action with audit metadata.
- Store vendor credentials only through approved secret storage; never commit credentials, account ids, support tickets, clinic contacts, or outreach transcripts.
- Keep vendor-specific details behind adapters; routes, components, and agent tool groups use normalized clinic data.
- Design every integration with revocable per-clinic consent and tenant-scoped audit logs.

## Current Seam

- Current runtime data comes from the mock clinic persistence modules in `packages/db`.
- `apps/internal/app/api/agent/_clinicData.ts` builds the agent clinic data projection.
- Agent tool groups consume normalized data from `packages/agents`, not vendor records.
- Future PIMS and lab adapters should feed the same normalized projection and persistence paths.

## Adapter Shape

Each PIMS or Lab integration adapter should own:

- Credential lookup and refresh.
- Vendor request/response mapping.
- Rate-limit and retry behavior.
- Read projection into clients, patients, appointments, visits, invoices, records, lab orders, and lab results.
- Staff-approved write-back commands.
- Error redaction for persisted tool calls and logs.
- Contract tests using captured, redacted fixtures.

## Write-Back Policy

Allowed only when all are true:

- Clinic consent exists for that vendor and scope.
- The actor is authenticated and authorized.
- The workflow has an explicit staff approval step when required.
- The write is persisted with trace id, actor, target record, vendor adapter, and result.
- Failure leaves a visible task/report instead of silently retrying forever.

## Documentation Policy

- Keep architecture and rules here.
- Keep outreach trackers, draft emails, account ids, phone scripts, and named contacts outside source docs.
- If vendor facts are needed for implementation, add a dated note with the official source URL and remove it once the adapter code or ADR owns the decision.
