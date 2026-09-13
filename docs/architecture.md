---
summary: "System boundaries and the main request, task, agent, notification, and automation flows."
read_when:
  - Changing app or package ownership boundaries
  - Moving behavior between routes, packages, persistence, or browser code
  - Adding a cross-cutting workflow
---

# Architecture

Vet is one Next.js app backed by Postgres workspace packages.
Public client flows, staff tools, and agent routes share one deployed surface and a tenant-scoped data model.
Central Veterinary Hospital and Tri-City Veterinary Hospital are separate tenants.
Their domains, branding, settings, and data must never fall back to one another.

## Design Principles

- Prefer deep modules: small caller-facing interfaces with sequencing and policy behind them.
- HTTP routes authenticate, validate, delegate, and map responses; request modules own workflow behavior.
- HTTP adapters use `withDbError` for route-labelled logging and consistent database and tenant failure responses.
- Add a shared package seam only when multiple callers need it.
- Use the domain language in `CONTEXT.md`.
- Keep SQL and row projection in `packages/db`, not routes or UI modules.
- Keep browser request payloads and response normalization in browser adapters, not components.
- Keep one browser workflow state machine per module; screen shells compose independent workflows instead of storing them in a mixed forms module.
- Put remote synchronization, cancellation, and request identity in screen-owned state modules; presentation modules consume typed snapshots.
- Use the stable React Compiler transform for render-local memoization; keep explicit memoization only when object or callback identity is part of a context, effect, or consumer contract.
- Redact agent tool traces before persistence.
- Plan notification delivery before transport; sending is an explicit side effect.
- Keep operational policy independent of process execution; use protocol-faithful in-process command doubles for policy tests, retain focused adapter contract tests, and synchronize asynchronous process tests on observed events instead of fixed delays.
- Keep proof orchestration separate from published-media integrity; orchestration selects lanes and outcomes while one inspection module owns bundle traversal, digest and head binding, playback probes, and sealed result validation.
- Keep isolated evaluator output interpretation at its own seam; one result module owns parsing, retry and repair classification, redaction, and the sealed artifact schema, while one native-fix module owns patch screening and exact-head Git application.

## Ownership

- `apps/internal`: deployed pages, HTTP adapters, browser UI, and app-local helpers.
- `packages/agents`: deterministic and Google ADK workflows, contracts, tools, and runtime adapters.
- `packages/db`: tenant resolution, parameterized queries, transitions, and row projection.
- `packages/notifications`: notification content, delivery planning, attempts, and transport.
- `packages/client-request`: public request validation, guards, logging, and task creation.
- `db/migrations`: append-only schema history.
- `scripts`: migrations, smoke/scenario proof, provisioning, and issue-automation CLIs.
- `.agent` and `.github/workflows/agent-*`: issue-automation policy, structured prompts, schemas, and orchestration.

## Main Flows

### Client Request

1. `/request` submits through a browser adapter to `POST /api/requests`.
2. The route delegates to `@central-vet/client-request`.
3. Validation, rate limits, and duplicate detection run before task creation.
4. `@central-vet/db` persists the tenant-scoped task for the staff board.

### Arrival Intake

1. Public pages collect Arrival identity before concern details.
2. The arrival request module attempts one safe same-day appointment match.
3. A Matched arrival records intake and optional room assignment.
4. Ambiguous or missing matches become an Arrival exception for front-desk help.

### Client Journey

1. New clients claim an existing clinic record with email or phone plus pet name, then verify a short-lived code; unmatched claims become staff-review tasks without revealing whether a record exists.
2. Tenant settings supply public branding, PIMS adapter mode, reminder cadence, quiet hours, feedback timing, and room-pressure thresholds.
3. Welcome, appointment preparation, consent-based reminders, hospitalized updates, pickup, checkout, discharge, feedback, and insurance help persist as customer-facing journey events or idempotent message plans.
4. A cron-authorized notification route dispatches due plans and rechecks current email and SMS consent before transport. Disabled mode holds customer delivery.
5. A negative visit response creates a private service-recovery task and suppresses the next-day pet check. A positive response schedules that pet check.
6. Customers see chat first and only current, actionable journey state. Pickup, discharge, and feedback controls stay hidden until their workflow state is due.
7. A records request creates a front-desk task. Authorization, recipient, and scope are confirmed by staff outside the customer portal.
8. Admin owns journey automation controls. Staff uses the task board for front-desk and cashier work; veterinarians use clinical task views.
9. Room and check-in controls open from a compact task-board dialog, refresh automatically, and show pressure only at two-thirds occupancy or higher.
10. Admin can edit future confirmation, reminder, feedback, pet-check, call-queue, and quiet-hour timing.
11. Saved tenant settings do not enable transport. `NOTIFICATION_MODE` remains the deployment-level delivery gate.

### Client Analytics

1. Check-in, room placement, care, and checkout write idempotent Visit stage events behind a PIMS-ready database interface.
2. The Admin-only analytics route calculates median and 90th-percentile stage time without substituting estimates for missing timestamps.
3. Completed visit stages drive returning-client and rebooking rates; journey responses drive satisfaction and pet-health rates.
4. A recovery email is scheduled after the configured pet-check delay.
5. An unanswered sent email enters the Admin call queue after the configured no-reply delay, while a recorded pet-health response removes it from that queue.
6. Admin analytics state keys snapshots to the signed-in session, rejects stale range responses, and exposes one small loading, error, refresh, and snapshot interface to presentation modules.

### Private Product Usage

1. A successful meaningful clinic-team action records one name-free activity bucket per person every five minutes. Passive reads and page refreshes do not.
2. Demo accounts, automated checks, and synthetic actors do not enter product usage.
3. A separate platform-operator credential protects the cross-tenant aggregate view and never accepts hospital Admin authorization.
4. The view reports daily active users, mature days 8 to 30 return rate, and monthly sessions inferred from 30-minute inactivity gaps.
5. The low-return email stays off by default and waits for five mature users.
6. The daily notification check sends once after crossing below 15%, then no more than once every 30 days while the rate remains low.
7. Product usage stores no patient, client, message, medical, or raw actor identity content.

### PIMS Ingestion

1. Datahub sends initial and incremental PIMS batches to the server-only webhook route.
2. The route authenticates and validates each batch before database work.
3. Practice mappings resolve the batch to exactly one hospital tenant; incomplete or cross-tenant mappings reject the whole batch.
4. The database module stores provider-neutral records idempotently, prevents older updates from replacing newer state, and returns one receipt per received entity.
5. Product flows continue using explicit PIMS adapters rather than reading provider payloads directly.

See `docs/datahub.md` for the webhook contract, persistence rules, and rollout runbook.

### Agent Workflow

1. The dynamic agent route resolves workflow, auth mode, and intent.
2. The runner loads normalized clinic data and selects deterministic or Google ADK execution.
3. Domain tool groups operate through package adapters.
4. App request modules persist effects, operational mutations, and redacted timeline data.
5. Dedicated manager email runs remain confirmation-gated and use the notification package.

See `docs/agent-architecture.md` for runtime, authorization, and safety boundaries. Route names and payload details live in source and tests rather than a mirrored inventory.

### Task Workflow

1. Task routes delegate create, update, and undo behavior to request modules.
2. App-local task policy determines valid actions and status transitions.
3. Database modules own writes, transition audit, and role-safe row projection.
4. Browser state modules own polling, forms, mutations, lane projection, and feedback.

### Notification Flow

1. A route or task workflow requests notification delivery.
2. The package renders content and resolves mode, channel, recipient, timezone, and opt-in policy.
3. The send pipeline writes an idempotent attempt before using configured transport.
4. Disabled and test modes remain explicit; production sends require approval and configuration.

### Agent Issue Automation

1. GitHub labels route work to reusable triage, implement, review, proof, or automerge workflows.
2. `.agent` owns policy, prompts, schemas, and configured checks.
3. `scripts/agent-*.mjs` own GitHub decisions and mutations; workflow YAML supplies permissions and job separation.
4. Codex jobs receive read access and produce structured output or patches. Separate jobs apply writes.
5. CI, review, proof when required, and either no-mistakes or an explicit exact-head owner bypass gate automerge.

See `docs/agent-automation.md` for the verified workflow contract.

## Compatibility and Cleanup

- Do not re-add `apps/client-request`, `packages/request-form`, `packages/request-intake`, or old `/api/agent/vet-*` routes.
- Keep Google ADK runtime imports behind `@central-vet/agents/adk-runtime`.
- Keep one canonical internal path. Compatibility requires a shipped public contract, migration boundary, or observed production state.
- Use `npm run lint:dead` after deletion and `npm run lint:duplicates` after structural refactors.
- Run `npm audit --omit=dev` after dependency changes.
- Use root `npm test` as the canonical deterministic test interface for app, package, database, and automation behavior.
- Update the owning durable doc when a boundary or public contract changes; do not mirror every implementation file.

## What Is Going On

Vet is a **modular monolith**: one Next.js deployment, one Postgres database, and several workspace packages with explicit ownership.

- **Ports and Adapters**: HTTP routes, Google ADK, PIMS providers, email, SMS, and Postgres are adapters around domain workflow modules.
- **Deep Module**: routes expose small interfaces; request and package modules hide validation, sequencing, policy, and failure handling. Published proof media uses one inspection interface over artifact traversal, cryptographic binding, playback probing, and outcome validation.
- **Anti-Corruption Layer**: the no-mistakes result module converts untrusted evaluator output into one bounded, redacted, head-bound artifact before trusted orchestration can act on it.
- **Facade**: native no-mistakes fixes expose patch creation and application while hiding bare-repository discovery, credential and privileged-path screening, immutable-tree verification, and force-with-lease publication.
- **Strategy**: the same agent workflow can select deterministic or Google ADK execution without changing its caller.
- **Factory**: focused creator functions assemble configured agent runtimes, clinic adapters, and notification senders behind those stable interfaces.
- **Decorator**: `withDbError` wraps HTTP adapters with one failure-mapping policy without changing each handler's interface.
- **Compiler-assisted React**: React Compiler owns render-local memoization; explicit `useMemo` and `useCallback` remain only where stable identity drives context propagation, external synchronization, or a consumer contract.
- **Single Responsibility and Cohesion**: login/reset and account claim/signup own separate state modules; screen shells compose them while cohesive deep modules remain intact.
- **Single Source of Truth**: one screen-owned state module owns each remote snapshot and its request identity; presentation modules receive read-only typed slices.
- **Repository and Data Mapper**: `packages/db` owns parameterized queries; `*Rows.ts` modules convert database rows into stable contracts.
- **State Machine**: tasks, claims, approvals, notifications, arrivals, and visit stages move through explicit allowed transitions.
- **Functional Core, Imperative Shell**: schemas, policy, planning, and projections stay deterministic; routes and persistence modules perform side effects.
- **Dependency Inversion**: workflow code depends on stable contracts so mock, Postgres, PIMS, and provider adapters can vary behind a seam.
- **Test Double**: policy tests use protocol-faithful in-process command adapters; focused contract tests execute real Git and subprocess adapters, while asynchronous tests advance on observed protocol events instead of wall-clock sleeps.
- **DRY plus YAGNI**: shared behavior moves into a package only when multiple callers need it; speculative abstractions stay out.

Find browser and HTTP code in `apps/internal`, workflow logic in `packages/agents`, persistence in `packages/db`, delivery in `packages/notifications`, public-request protection in `packages/client-request`, schema history in `db/migrations`, and operational automation in `scripts`.
