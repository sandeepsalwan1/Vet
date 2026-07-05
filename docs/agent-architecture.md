# Agent Architecture

Date: 2026-07-03

Status: current external/internal agent reference.

## Core Rules

- External agent is client-facing only.
- Internal agent is manager-authenticated only.
- There are two top-level agent identities: `ExternalAgent` and `InternalAgent`.
- Booking, records, email, pricing, invoices, labs, memory, and decisions are capabilities/tools, not worker agents.
- Prompts are not the security model. Routes, auth, tool allowlists, persistence, and scenario tests enforce behavior.
- Normal demo routes do not create unnecessary pending-review work; workflows either act safely, record an audit/report, or return a clear blocker.
- Medical safety is a guardrail around client text. The product must not provide diagnosis or treatment advice.

## Current Shape

- One deployed app: `apps/internal`.
- Public flows call `POST /api/agent/[workflow]` for external workflows.
- Staff/admin flows call manager-authenticated internal routes.
- `_workflowRoutes.ts` owns route slug mapping, auth mode, and route-intent normalization.
- `_runner.ts` owns runtime execution, persistence, response contracts, and fallback behavior.
- `email/_emailWorkflow.ts` owns the dedicated manager email workflow lifecycle; `email/route.ts` is only auth, guard, delegate.
- `@central-vet/agents` exposes deterministic workflow contracts plus external/internal runners; tool registry and adapters stay package-local.
- `@central-vet/agents/adk-runtime` isolates Google ADK imports from the app bundle.
- ADK tool allowlists are split into shared safe, external, and internal sets and are checked by `npm run test:scenarios`.
- `@central-vet/db` owns Postgres persistence and row projection.
- `@central-vet/notifications` owns notification content, planning, attempts, and transport.

## Route Table

Public/external:

- `POST /api/agent/checkin`
- `POST /api/agent/booking`
- `POST /api/agent/pickup`
- `POST /api/agent/records`
- `POST /api/agent/followup`
- `POST /api/agent/call`
- `POST /api/agent/external`

Manager/internal:

- `POST /api/agent/internal`
- `POST /api/agent/daily-ops`
- `POST /api/agent/pricing`
- `POST /api/agent/invoice`
- `POST /api/agent/email`
- `GET /api/agent/decisions`
- `GET /api/agent/memory`
- `POST /api/agent/memory`
- `PATCH /api/agent/memory`
- `DELETE /api/agent/memory`
- `GET /api/agent/runs/[id]`

Supporting manager routes:

- `GET /api/approvals`
- `PATCH /api/approvals/[id]`
- `GET /api/reports/pricing`
- `GET /api/reports/invoices`
- `GET /api/reports/followups`

## External Agent

Allowed outcomes:

- Match or exception an arrival intake.
- Book mock appointment slots.
- Send mock pickup/follow-up/status updates.
- Prepare and audit records transfer.
- Create a safe client request or clinic inbox message.
- Dispatch urgent clinical handoff without giving medical advice.

Denied outcomes:

- Internal task list, approvals, reports, pricing, invoices, lab results, bulk email, or staff-only notes.
- Diagnosis, treatment advice, or silent destructive changes.

## Internal Agent

Allowed outcomes:

- Daily ops digest.
- Pricing report.
- Invoice report.
- Records/admin workflow help.
- Staff-visible decisions, memory, reports, tasks, and run timelines.
- Monthly example email through the dedicated manager route with disabled/test/production modes.

Denied outcomes:

- Silent destructive actions.
- Medical advice.
- Client-facing disclosures that have not passed the workflow guardrails.

## Tool Locality

- Route-to-agent mapping: `apps/internal/app/api/agent/_workflowRoutes.ts`.
- Route execution: `apps/internal/app/api/agent/_runner.ts`.
- Runtime mode/model policy: `packages/agents/src/runtimeConfig.ts`.
- Public guard/rate-limit/dedupe: `apps/internal/app/api/agent/_publicAgentGuard.ts`.
- Manager auth: `apps/internal/app/api/_shared.ts` via manager query/body helpers.
- Agent data projection: `apps/internal/app/api/agent/_clinicData.ts`.
- Agent effect persistence: `apps/internal/app/api/agent/_effectPersistence.ts`.
- Operational tool-call persistence: `apps/internal/app/api/agent/_operationalMutations.ts`.
- Agent email workflow: `apps/internal/app/api/agent/email/_emailWorkflow.ts`.
- Agent memory requests: `apps/internal/app/api/agent/memory/_memoryRequest.ts`.
- Agent tool groups: `packages/agents/src/toolGroups/`.
- Browser agent adapter: `apps/internal/app/lib/agentClient.ts`.

## Open Checks

- Keep route-level negative scenarios for denied external access to internal reports, pricing, invoices, labs, memory, and email in `npm run scenarios:local`.
- Keep PIMS/lab adapters behind the mock clinic and database seams; do not leak vendor details into route/UI code.
- Expand memory/decision lifecycle UI only through browser adapters (`agentClient.ts` or `agentAuditClient.ts`), not direct component fetches.
- Keep generated verification proof local-only outside `docs/` by default.
