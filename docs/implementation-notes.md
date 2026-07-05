# Implementation Notes

Last updated: 2026-07-03

Current implementation details that are too specific for `architecture.md`.

## Stack

- Next.js app router, TypeScript, npm workspaces.
- Supabase Postgres through `postgres`.
- Resend for email and carrier-gateway SMS notifications.
- Render hosts the unified app and cron jobs.
- Dependency holds: `@google/genai` v1 for `@google/adk`, ESLint v9 for the Next/react lint stack, and `@types/node` for the supported Node engine line.

## App Shape

- Staff and public routes are served by `apps/internal`.
- `/request` renders `apps/internal/app/components/RequestForm.tsx`.
- `POST /api/requests` calls `@central-vet/client-request`.
- Agent workflow URLs use one dynamic adapter at `apps/internal/app/api/agent/[workflow]/route.ts`.
- `apps/internal/app/api/agent/_workflowRoutes.ts` owns workflow-to-auth/intent mapping.
- `_runner.ts` owns runtime execution, persistence, and fallback events.
- `apps/internal/app/api/_shared.ts` owns actor auth, manager query/body auth, and clinic resolution.
- `apps/internal/app/api/_apiResponse.ts` owns no-store headers, structured route logging, and database/server error responses.
- Report routes share `apps/internal/app/api/reports/_reportRoute.ts`.

## Tenant Data

- Host resolution lives in `packages/db/src/clinics.ts`.
- Clinic row projection lives in `packages/db/src/clinicRows.ts`.
- API routes call `resolveClinicFromRequest` before auth and persistence.
- Tenant-owned rows carry `clinic_id`.
- Task, mock clinic, agent, approval, report, notification, request guard, and auth-attempt queries scope by clinic.
- Clinic onboarding command: `npm run clinic:provision -- --slug <clinic-slug> --name <clinic name> --host <clinic-slug>.vet.eepish.com`.

## Client Request

- Client request behavior lives in `@central-vet/client-request`.
- `clientRequestGuard.ts` owns memory rate-limit, persistent rate-limit, duplicate detection, and guard-event writes.
- `clientRequestValidation.ts` owns public request schema and field validation.
- `clientRequestLogger.ts` owns structured request logging with hashed identifiers.

## Task Workflow

- Task create request validation and duplicate/staff rate-limit rules live in `apps/internal/app/api/tasks/_taskCreateRequest.ts`.
- Task update request validation, workflow checks, persistence, and escalation trigger live in `apps/internal/app/api/tasks/[id]/_taskUpdateRequest.ts`.
- Task visibility projection lives in `apps/internal/app/api/tasks/_taskVisibility.ts`.
- Task board browser mutation side effects live in `apps/internal/app/components/useTaskBoardTaskActions.ts`.
- Task board profile-name save, optimistic actor rename, and rollback live in `apps/internal/app/components/useTaskBoardProfileName.ts`.
- Admin dashboard task polling and new-count state live in `apps/internal/app/components/admin/useAdminTaskSnapshot.ts`.
- Admin assistant messages, quick-action loading, and internal-agent sends live in `apps/internal/app/components/admin/useAdminAssistantChat.ts`.
- Task persistence lives in `packages/db/src/tasks.ts`, `taskTransitions.ts`, `taskAudit.ts`, `taskWriteRows.ts`, and `taskRows.ts`.
- Completed tasks from prior local days auto-archive as `System` before task lists and daily alerts are checked.

## Agent Runtime

- `@central-vet/agents` root exports workflow contracts plus external/internal runners.
- `packages/agents/src/agentVocabulary.ts` owns shared agent intent, runtime mode, task priority, and task request type names.
- `packages/agents/src/runtimeConfig.ts` owns runtime mode, Google credential state, and model-name policy shared by package code and app route runners.
- `packages/agents/src/mockClinicContracts.ts` owns the mock clinic data contract shared by tools, adapters, scenario data, and app clinic-data projection.
- `@central-vet/agents/adk-runtime` isolates Google ADK imports from the app bundle.
- Tool registry and adapters stay package-local.
- `packages/agents/src/adapters.ts` defines runtime operation interfaces; `mockClinicAdapters.ts` implements deterministic in-memory behavior over mock clinic data.
- Mock clinic lookup/id helpers live in `packages/agents/src/mockClinicLookup.ts` and are shared by `toolCore.ts` and the mock adapters.
- ADK tool names are split in `adkTools.ts`; `scenarioRunner.ts` checks external/internal allowlists.
- Agent tool groups live in `packages/agents/src/toolGroups`.
- Agent clinic data projection lives in `apps/internal/app/api/agent/_clinicData.ts`.
- Agent workflow route mapping and route-intent normalization live in `apps/internal/app/api/agent/_workflowRoutes.ts`.
- Agent effect persistence lives in `_effectPersistence.ts`.
- State-changing tool-call persistence lives in `_operationalMutations.ts`.
- Agent run, workflow event, approval, report, and tool-call projection lives in `packages/db/src/agentRows.ts`.
- Agent decision projection lives in `packages/db/src/agentDecisionRows.ts`; decision persistence lives in `packages/db/src/agentDecisions.ts`.
- Agent memory projection lives in `packages/db/src/agentMemoryRows.ts`; memory search/correction persistence lives in `packages/db/src/agentMemory.ts`.
- Run timeline assembly lives in `packages/db/src/agentTimeline.ts`.
- Agent JSON persistence policy lives in `packages/db/src/agentJson.ts`.

## Mock Clinic

- Query and mutation operations live in `packages/db/src/mockClinic.ts`.
- Full agent-runtime snapshot query lives in `packages/db/src/mockClinicSnapshot.ts`.
- Arrival appointment matching and matched-arrival submission live in `packages/db/src/arrivalIntake.ts`; room setup/turnover lives in `arrivalRooms.ts`; row projection lives in `arrivalIntakeRows.ts`.
- Pricing review reads service catalog and competitor observations from the agent-runtime snapshot; live scan results stay in runtime data and the final review is persisted as an agent report.
- Core, pricing, and lab row projection live in `mockClinicRows.ts`, `mockClinicPricingRows.ts`, and `mockClinicLabRows.ts`.

## Notifications

- `@central-vet/notifications` owns notification orchestration.
- `notificationContent.ts` renders HTML/text.
- `notificationDelivery.ts` plans mode, channel, recipient, timezone, and opt-in targets.
- `notificationSend.ts` owns idempotent notification attempts and Resend transport.
- Delivery starts disabled; production sends require explicit mode/env configuration.
- Veterinarian profiles start opted out until explicitly enabled.
- Recipient profile reads merge legacy unscoped `app_settings` rows with clinic-scoped rows; scoped rows win per profile id.
- Escalation notifications go to active veterinarian profiles only, not Admin.

## Browser Locality

- `AppRoot.tsx` validates staff, veterinarian, and admin account sessions against `/api/auth`; rejected team account sessions are cleared and sent to the passcode task board.
- `accountModel.ts` owns browser demo account types, storage keys, and built-in demo account constants.
- `accountStore.ts` owns browser demo account persistence, email normalization, OTP reset, and team account lifecycle.
- `accountSessionStore.ts` owns account-session persistence and demo passcode bridging for task-board manager routes.
- Arrival intake browser settings load, customer autofill, match/submit mutations, and step state live in `apps/internal/app/components/useArrivalIntakeFlow.ts`.
- Arrival questionnaire browser defaults and submit payload shaping live in `apps/internal/app/components/arrivalIntakeAnswers.ts`; reason-specific fields live in `ArrivalQuestionFields.tsx`.
- Arrival Desk browser request payloads live in `apps/internal/app/components/arrivalDeskClient.ts`.
- Arrival Desk polling, room/check-in state, settings drafts, and saves live in `apps/internal/app/components/useArrivalDeskState.ts`.
- Browser response/error normalization lives in `apps/internal/app/lib/apiClient.ts`.
- Browser phone input/display normalization lives in `apps/internal/app/lib/phoneText.ts`.
- Veterinarian profile naming and profile-id normalization live in `apps/internal/app/lib/veterinarianProfile.ts`.
- `TaskBoard.tsx` owns task state orchestration.
- `TaskBoardPanels.tsx` owns lane/audit/archive rendering.
- `TaskCard.tsx`, `TaskForm.tsx`, and `TaskBoardChrome.tsx` own repeated task-board UI.
- `TaskBoardSettings.tsx` owns notification settings/profile UI.
- `StaffAgentConsole.tsx` owns internal-agent run state; `StaffAgentResultPanel.tsx` owns result rendering; `useStaffAgentAudit.ts` owns decision/memory audit state.
- `ApprovalQueue.tsx` renders access states and approval rows; `useApprovalQueueState.ts` owns stored-session loading, approval listing, decisions, and errors.
- `useTaskBoardSettings.ts` owns notification settings state and mutations.
- `useTaskBoardForm.ts` owns create/edit modal state, task form projection, save side effects, refresh, sync, errors, and toast.
- `useTaskBoardProfileName.ts` owns profile-name save state and optimistic task/event actor renames.
- `taskBoardState.ts` owns form/state projection helpers.
- `taskBoardBrowserState.ts` owns browser session/sync rules.
- `taskBoardDisplay.ts` owns lane projection, counts, display, and ordering policy.
- `taskBoardClient.ts` owns task-board task request payloads and route reads/mutations.
- `taskBoardSettingsClient.ts` owns notification settings/profile request payloads and response projection.
