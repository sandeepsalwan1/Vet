# VetAgent Agent Route Contracts

Date: 2026-07-03

All routes live in the unified `apps/internal` app.

## Shared response

Agent workflow routes return:

- `ok`: boolean
- `mode`: `mock`, `google-adk`, `apify`, or future runtime
- `intent`: workflow intent
- `message`: user-facing or staff-facing summary
- `result`: structured workflow data
- `task`: task created only for explicit task-board workflows
- `approval`: approval returned only when a route or future workflow emits an explicit approval draft; current normal workflows avoid HITL approval drafts
- `report`: report created when relevant
- `workflowEvents`: timeline events
- `toolCalls`: redacted tool-call traces
- `runId`: persisted agent run id
- `traceId`: trace id also returned as `x-vetagent-trace-id`
- `durationMs`: server-side workflow duration

## Public routes

Agent workflow URLs below are implemented by `apps/internal/app/api/agent/[workflow]/route.ts`; static URL contracts stay unchanged.

- `POST /api/agent/checkin`: client arrival/check-in.
- `POST /api/agent/booking`: booking request and mock slots.
- `POST /api/agent/pickup`: pickup/status request.
- `POST /api/agent/records`: audited mock records transfer; no approval.
- `POST /api/agent/followup`: mock portal outreach.
- `POST /api/agent/call`: transcript triage to direct mock integration.
- `POST /api/agent/external`: generic external-agent router.
- `POST /api/requests`: internal-app public request form; creates a task.
- Request form UI lives in the internal app.
- Client request guard, validation, duplicate detection, and task creation use `@central-vet/client-request`.

Example public payload:

```json
{
  "clientName": "Maya Parker",
  "clientPhone": "(415) 555-0134",
  "petName": "Biscuit",
  "message": "I'm outside for my appointment."
}
```

## Internal routes

Internal routes require the existing actor payload and passcode rules:

```json
{
  "actor": {
    "name": "Admin",
    "role": "admin",
    "passcode": "not-committed"
  },
  "message": "Summarize what front desk should do next."
}
```

Read routes pass manager passcodes in `X-Central-Vet-Passcode`; write routes use the actor body. Do not send passcodes in query strings.

- `POST /api/agent/internal`: generic internal-agent router.
- `POST /api/agent/daily-ops`: daily ops digest.
- `POST /api/agent/pricing`: pricing report; uses Apify only when configured and requested with `live: true`.
- `POST /api/agent/invoice`: invoice audit report.
- `GET /api/agent/runs/[id]`: run, workflow events, tool calls, approvals, reports, and linked task/report/approval ids.
- `GET /api/agent/decisions`: manager-authenticated decision audit list.
- `GET /api/agent/memory`: manager-authenticated memory list/search.
- `POST /api/agent/memory`: create manager-authenticated memory.
- `PATCH /api/agent/memory`: correct manager-authenticated memory.
- `DELETE /api/agent/memory`: delete manager-authenticated memory.
- `GET /api/approvals?role=admin&name=...`: pending approvals.
- `PATCH /api/approvals/[id]`: approve/reject.
- `GET /api/reports/pricing`: pricing reports.
- `GET /api/reports/invoices`: invoice reports.
- `GET /api/reports/followups`: follow-up reports and open followups.
- `GET /api/mock/clinic`: manager-authenticated mock clients, pets, appointments, slots, followups, invoices, messages, calls, services, pricing observations, and Antech-shaped mock lab data.
- `POST /api/mock/clinic`: manager-authenticated mock state reset for reproducible demos/scenarios.

## Safety behavior

- Sick-pet messages dispatch a mock clinical triage alert; no diagnosis.
- Records transfer creates a local `local_records_policy` audit and submits a mock secure transfer; no HITL approval.
- Invoice review creates a report; no invoice mutation.
- Pricing review creates a report; no repricing.
- Google ADK/E2B/Apify are optional live tools. Deterministic mock behavior keeps demo routes working without live tools. Google ADK TypeScript is the target live agent runtime behind `AGENT_RUNTIME=google-adk`; use `GEMINI_API_KEY` or `GOOGLE_API_KEY` for Gemini, or Vertex env for Google Cloud. The app reads `APIFY_API_TOKEN`; the Apify CLI skill reads `APIFY_TOKEN`.
- Internal lab review uses mock `antech_mock` catalog/orders/results, prepares a safe client-update state, holds abnormal results from delivery, and never discloses medical advice automatically.

## Scenario Proof

- `npm run smoke:local`: local health proof that warms demo pages/routes, then enforces route speed budgets.
- `npm run test:scenarios`: deterministic workflow scenarios and ADK tool-boundary allowlist check.
- `npm run scenarios:local`: semantic scenario harness against local routes, including manager-only denial checks for reports, pricing, invoices, labs, memory, and email.
- `npm run verify:agents`: fallback-safe proof appender; expects a reachable app.
- `npm run verify:agents:google`: requires Google credentials and an app started with `AGENT_RUNTIME=google-adk`.
- `npm run smoke:e2b`: E2B credential/sandbox smoke.
- `npm run scenarios:e2b`: E2B scenario harness for public `SCENARIO_BASE_URL`; localhost falls back to local after E2B readiness.
