# Architecture

Central Veterinary Hospital is one Next.js app backed by Postgres workspace packages. The app has public client flows, staff tools, and agent routes in one deployed surface so tenant, auth, task, notification, and agent behavior share one data model.

## Design Principles

- Deep modules over pass-through files: keep a small interface with behavior behind it.
- HTTP routes are adapters: authenticate, validate, call a module, return a contract.
- Package seams exist only when multiple callers need them.
- Domain words come from `CONTEXT.md`; use Client request, Arrival intake, PIMS, Lab integration, Matched arrival, and Task workflow consistently.
- Persistence owns projection: SQL row shape stays in `packages/db`, not routes or UI modules.
- Agent tools are domain-owned groups composed by the registry; tool-call traces are redacted before persistence.
- Notification sending is planned before transport; content, delivery planning, and send side effects stay separate.

## Runtime Shape

- `apps/internal`: deployed app, pages, HTTP adapters, browser UI, app-local helpers.
- `packages/agents`: agent workflows, tool groups, deterministic runtime, Google ADK adapter.
- `packages/db`: tenant resolution, SQL queries, task/agent/mock-clinic persistence, row projection.
- `packages/notifications`: notification content, delivery planning, idempotent send pipeline.
- `packages/client-request`: Client request validation, guard, logging, and task creation.
- `db/migrations`: append-only schema history.
- `scripts`: migrations, local smoke, scenario/proof helpers.

## Main Flows

Client request:

1. `/request` renders `apps/internal/app/components/RequestForm.tsx`.
2. `requestFormClient.ts` submits the browser payload to `POST /api/requests`.
3. `POST /api/requests` validates the request and calls `@central-vet/client-request`.
4. Client request guard checks rate limit and duplicates.
5. Client request path creates a task through `@central-vet/db`.
6. Staff sees the task on the task board.

Arrival intake:

1. Public arrival pages collect Arrival identity.
2. `_arrivalIntakeRequest.ts` matches a same-day appointment through the Arrival appointment match query.
3. A Matched arrival records check-in state and optional room assignment.
4. An Arrival exception is captured when one safe appointment match is not possible.

Agent workflow:

1. `apps/internal/app/api/agent/_workflowRoutes.ts` maps workflow path to agent kind and auth policy.
2. `_runner.ts` loads clinic data, runs deterministic or Google ADK runtime, then persists run state.
3. `packages/agents/src/toolGroups` own tool behavior by domain.
4. `_effectPersistence.ts` and `_operationalMutations.ts` turn agent effects into database state.
5. `GET /api/agent/runs/[id]` reads the persisted timeline.
6. Dedicated email campaign sends use `email/_emailWorkflow.ts`; the route stays an auth/guard adapter.

Task workflow:

1. Task create/update/undo routes delegate auth, validation, workflow guards, persistence, notifications, and projection to request modules.
2. `apps/internal/app/lib/taskWorkflow.ts` owns status/action rules.
3. `packages/db/src/taskTransitions.ts`, `taskAudit.ts`, and `taskWriteRows.ts` own persistence.
4. Task board modules project lane membership, visible actions, and browser state.

Notification flow:

1. Route or task workflow asks `@central-vet/notifications` to send.
2. Content module renders HTML/text.
3. Delivery planning chooses mode, channel, recipient, timezone, and opt-in targets.
4. Send pipeline writes idempotent attempts and uses Resend only when mode allows.

## Key Seams

- Client request seam: `@central-vet/client-request` hides validation, guard, duplicate detection, logging, and task creation.
- Request form browser adapter seam: `components/requestFormClient.ts` owns Client request submission payloads.
- Clinic browser adapter seam: `clinicClient.ts` owns `/api/clinic` reads and default brand fallback.
- Agent runtime seam: `@central-vet/agents` exposes workflow contracts and external/internal runners; package-local tools stay behind that interface. `@central-vet/agents/adk-runtime` isolates Google ADK.
- Agent runtime config seam: `@central-vet/agents` exports resolved runtime mode, Google credential state, and model-name policy so app runners do not duplicate env checks.
- Agent vocabulary seam: `packages/agents/src/agentVocabulary.ts` owns stable intents, modes, mock delivery channels, and mock lab names shared by workflows, tools, and adapters.
- Mock clinic contract seam: `packages/agents/src/mockClinicContracts.ts` owns the mock clinic data shape shared by tools, adapters, scenarios, and app clinic-data projection.
- Agent adapter seam: `packages/agents/src/adapters.ts` owns runtime operation interfaces; `mockClinicAdapters.ts` owns deterministic mock mutations behind that interface.
- Mock clinic lookup seam: `packages/agents/src/mockClinicLookup.ts` keeps shared id/name/phone matching behind agent runtime and mock adapter code.
- Mock clinic request seam: `apps/internal/app/api/mock/clinic/_mockClinicRequest.ts` hides manager auth, fixture snapshot, and reset behavior from the route.
- Route auth seam: `_shared.ts` owns actor auth, manager query auth, and manager body auth.
- Auth request seam: `apps/internal/app/api/auth/_authRequest.ts` hides passcode actor validation, clinic resolution, actor authentication, rejection logging, and no-store response mapping from the route.
- Route response seam: `_apiResponse.ts` owns no-store headers, structured route logging, and database/server error responses.
- Agent workflow route seam: `apps/internal/app/api/agent/_workflowRoutes.ts` owns route slug mapping, auth mode, and route-intent normalization.
- Agent audit request seam: `apps/internal/app/api/agent/_auditRequest.ts` hides manager auth, decision filters, run timeline lookup, not-found handling, and no-store response mapping from audit routes.
- Arrival intake request seam: `apps/internal/app/api/arrival-intake/_arrivalIntakeRequest.ts` hides public/staff auth, request validation, public match/submit, staff desk mutations, and HTTP response mapping from the route.
- Arrival room persistence seam: `packages/db/src/arrivalRooms.ts` owns default room setup, assignment, checkout, and cleaning auto-open rules.
- Arrival intake browser adapter seam: `components/arrivalIntakeClient.ts` owns public Arrival settings, identity match, and questionnaire-submit request payloads.
- Arrival intake flow seam: `components/useArrivalIntakeFlow.ts` owns customer autofill, matched arrival state, step transitions, errors, and loading state.
- Arrival desk browser adapter seam: `components/arrivalDeskClient.ts` owns browser request payloads for Arrival Desk reads and staff mutations.
- Arrival desk state seam: `components/useArrivalDeskState.ts` owns polling, settings draft projection, room updates, checkout, and Arrival questionnaire saves for the task board.
- Task audit event request seam: `apps/internal/app/api/events/_eventRequest.ts` hides event-read auth, permission logging, and tenant-scoped query from the route.
- Task list request seam: `apps/internal/app/api/tasks/_taskListRequest.ts` hides list auth, query parsing, read-side archive cutoff, no-store response, and role-specific projection from the route.
- Task visibility seam: `apps/internal/app/api/tasks/_taskVisibility.ts` hides staff-safe task response projection from task routes.
- Task undo request seam: `apps/internal/app/api/tasks/[id]/undo/_taskUndoRequest.ts` hides undo auth, persistence, logging, and role-specific projection from the route.
- Profile-name request seam: `apps/internal/app/api/profile-name/_profileNameRequest.ts` hides payload/auth validation, actor display-name updates, reference renames, logging, and HTTP response mapping from the route.
- Agent memory request seam: `apps/internal/app/api/agent/memory/_memoryRequest.ts` hides manager auth, memory query/mutation validation, actor metadata, DB calls, and HTTP response mapping from the route.
- Staff agent audit seam: `components/useStaffAgentAudit.ts` owns decision/memory loading and memory writes for the internal-agent console.
- Public agent flow config seam: `components/publicAgentFlowConfig.ts` owns workflow-specific public form copy/options so route pages only choose workflow keys.
- Public agent browser adapter seam: `agentClient.ts` owns public workflow route mapping and form payloads plus customer/staff chat payloads.
- Persistence seam: `@central-vet/db` hides SQL and row projection.
- Notification seam: `@central-vet/notifications` hides delivery rules and transport.
- Notification request seam: `apps/internal/app/api/notifications/_notificationRequest.ts` hides cron authorization, env parsing, daily/monthly/smoke send behavior, logging, and HTTP response mapping from notification routes.
- Settings request seam: `apps/internal/app/api/settings/_settingsRequest.ts` hides settings access validation, profile mutation, notification-settings projection, logging, and HTTP response mapping from the route.
- Browser API seam: `apiClient.ts` owns JSON/error normalization for browser fetches.
- Browser actor seam: `browserActor.ts` owns actor body, manager read query, and passcode read-header projection for browser route adapters.
- Account auth browser adapter seam: `authClient.ts` owns `/api/auth` request payloads and validation-state projection.
- Account auth shell seam: `AppRoot.tsx` owns customer/staff audience routing and asks the auth adapter to validate team account sessions before manager routes render.
- Veterinarian profile seam: `veterinarianProfile.ts` owns doctor-name and profile-id normalization.
- Task board browser seam: `taskBoardClient.ts`, `taskBoardSettingsClient.ts`, `taskBoardState.ts`, `taskBoardDisplay.ts`, `taskBoardBrowserState.ts`, `useTaskBoardForm.ts`, `useTaskBoardTaskActions.ts`, and `useTaskBoardProfileName.ts` keep UI state and mutation rules out of cards.
- Admin dashboard task seam: `components/admin/useAdminTaskSnapshot.ts` owns polling, active-task filtering, new-task counts, and stats for the admin Tasks tab.
- Admin assistant chat seam: `components/admin/useAdminAssistantChat.ts` owns assistant messages, quick-action loading, internal-agent sends, and task refresh after agent runs.
- Approval request seam: `apps/internal/app/api/approvals/_approvalRequest.ts` hides approval list/create/decision auth, validation, persistence, and HTTP response mapping from approval routes.
- Approval Queue browser adapter seam: `components/approvalQueueClient.ts` owns approval-list and approve/reject request payloads.
- Approval Queue state seam: `components/useApprovalQueueState.ts` owns stored-session loading, approval list state, saving state, errors, and refresh after decisions.

## Cleanup Rules

- Do not re-add `apps/client-request`, `packages/request-form`, `packages/request-intake`, or old `/api/agent/vet-*` routes.
- Keep active docs flat under `docs/`; delete superseded plans/handoffs instead of archiving them in-repo.
- Keep generated verification proof outside `docs/` by default.
- Run `npm run lint:dead` and `npm run lint:duplicates` after deleting files.
- Run `npm audit --omit=dev` after dependency updates.
- Update nearest `AGENTS.md` when a module's interface or ownership changes.
