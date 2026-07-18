---
summary: "External and internal agent ownership, runtime boundaries, and safety invariants."
read_when:
  - Changing agent runtimes, tools, permissions, or persistence
  - Adding an agent capability or workflow
  - Reviewing client-facing medical or data-access safety
---

# Agent Architecture

## Identities

Vet has two top-level agent identities:

- `ExternalAgent`: client-facing workflows only.
- `InternalAgent`: manager-authenticated staff workflows only.

Booking, records, email, pricing, invoices, labs, memory, and decisions are capabilities or tools, not independent worker agents.

## Enforcement

Prompts are not the security boundary. Routes, actor authentication, tenant resolution, tool allowlists, persistence rules, and scenario tests enforce access and behavior.

- Public workflows cannot read staff tasks, approvals, reports, pricing, invoices, lab results, memory, bulk email, or staff-only notes.
- Internal workflows require manager authentication before staff data or mutations are available.
- Client-facing text must not diagnose or recommend treatment.
- Destructive or production-send behavior cannot happen silently.
- Tool calls and stored JSON are redacted and bounded before persistence.

## Runtime Boundary

`@central-vet/agents` exposes workflow contracts and the external/internal runners. The deterministic runtime remains usable without Google credentials. Google ADK code is exported only through `@central-vet/agents/adk-runtime` and loaded from server code.

The app owns HTTP concerns and persistence orchestration:

- workflow/auth selection and request guards
- normalized clinic-data projection
- run, event, decision, memory, report, approval, and tool-call persistence
- operational mutations produced by successful tools
- stable HTTP response mapping

The package owns agent behavior:

- workflow schemas and result contracts
- runtime selection inputs and model policy
- domain tool groups and allowlists
- runtime adapters and deterministic mock behavior

## HTTP Boundary

- Public routes never accept manager credentials or expose staff-only workflows and data.
- Manager reads use `X-Central-Vet-Passcode`; writes carry actor credentials in JSON. Credentials never belong in URLs, logs, examples, or tool traces.
- Routes authenticate, validate, delegate to request modules or packages, then map a stable role-safe response.
- Missing live-runtime credentials may fall back to deterministic execution only when the response and timeline expose that fallback.
- Workflow names, route lists, payload fields, and response fields are implementation contracts owned by source, schemas, and scenario tests. Do not mirror them here.

## External Outcomes

External workflows may match or exception an arrival, book mock slots, send mock status updates, prepare audited records transfer, create a safe request or clinic message, and dispatch urgent clinical handoff without medical advice.

## Internal Outcomes

Internal workflows may produce daily operations, pricing, invoice, records, decision, memory, report, task, run-timeline, and confirmation-gated email outcomes. Reports do not silently mutate invoices or pricing. Abnormal mock lab results are held from automatic client delivery.

## Verification

- `npm run test:scenarios` checks deterministic workflows and tool boundaries.
- `npm run scenarios:local` exercises local HTTP routes, including denied external access to manager capabilities.
- `npm run verify:agents` proves the fallback-safe local path against a running app.
- `npm run verify:agents:google` requires Google credentials and a Google ADK server runtime.

Keep future external-system adapters behind normalized package/database contracts. Browser agent features must use browser adapters instead of direct component fetches.
