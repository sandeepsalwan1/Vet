# Central Veterinary Hospital Context

## Language

**Client request**:
A non-arrival client ask that becomes clinic staff work.
_Avoid_: Request intake

**Arrival intake**:
A client check-in for today's visit, with identity, visit reason, and concern-specific questions. It may match an appointment and place the patient in the arrival flow.
_Avoid_: Check-in request, seating

**Customer account**:
An optional pet-owner identity used to prefill public flows and access the portal.
_Avoid_: Required check-in login

**Account claim**:
A customer account activation that proves control of a phone number or email already associated with a clinic client record.
_Avoid_: Staff-created customer password

**PIMS**:
The clinic system of record for clients, patients, appointments, visits, and record write-backs.
_Avoid_: Lab system

**Lab integration**:
A diagnostic lab connection for orders, results, and lab report status.
_Avoid_: PIMS

**Matched arrival**:
An arrival intake that confidently links to one current clinic appointment and patient record using the customer account or the contact number on the clinic record, allowing automatic check-in actions.
_Avoid_: Pending staff review for matched check-in

**Arrival identity**:
The customer, patient, and verified clinic contact used to match an arrival before collecting visit questions.
_Avoid_: Free-form check-in identity

**Arrival exception**:
An arrival that cannot be safely matched to one current appointment and needs front-desk help before full intake.
_Avoid_: Unmatched full intake

**Visit reason**:
The primary reason for today's matched appointment, defaulted from the appointment when known and confirmed by the customer during arrival.
_Avoid_: Main concern

**Arrival questionnaire**:
The concern-specific questions collected after arrival identity is matched, using a fixed clinic form whose questions and options can be edited by admin.
_Avoid_: Pre-match intake form

**Check-in room**:
A clinic-controlled room that can receive matched arrivals when room assignment is enabled.
_Avoid_: Seating

**Room assignment**:
The placement of a matched arrival into an available check-in room, with the clinic team able to override room state.
_Avoid_: Staff-confirmed recommendation

**Room turnover**:
The process of moving a room from occupied to cleaning to open after a visit is done, preferably from a PIMS signal with clinic-team fallback.
_Avoid_: Manual-only room release

## Implementation Map

- Task workflow: rules for task creation, status moves, archive/restore, escalation, assignment side effects, and audit meaning.
- Clinic row projection: database row-to-contract mapping for clinic tenancy rows.
- Clinic browser adapter: browser request payload and fallback projection for clinic brand context.
- Client request path: public or internal path that accepts clinic work and creates a task.
- Client request guard: memory rate-limit, persistent rate-limit, duplicate detection, and guard-event writes.
- Client request validation: public request schema and real-client/pet/request field validation.
- Client request logging: structured client request event logging with hashed request/client identifiers.
- Request form browser adapter: browser request payload and response normalization for Client request submission.
- Request form: internal app UI that collects Client request fields and renders validation/submission state.
- Internal task create request: actor auth, payload validation, source/status derivation, duplicate/rate-limit guard, task insert, and staff-safe response projection.
- Internal task update request: actor auth, edit/status/archive/restore/escalate validation, workflow checks, task persistence, escalation notification trigger, update logging, and role-safe response projection.
- Internal task undo request: manager auth, undo persistence, update logging, and role-safe response projection.
- Agent tool group: domain-owned agent tool definitions composed by the central agent tool registry.
- Agent vocabulary: shared agent intent, runtime mode, task priority, task request type, mock delivery channel, and mock lab names used by workflow and mock clinic contracts.
- Agent runtime config: shared runtime mode, Google credential state, and model-name policy used by agent package code and app route runners.
- Mock clinic contract: agent-package type surface for mock clinic clients, pets, appointments, pricing, invoices, tasks, reports, messages, calls, and lab data.
- Clinic lookup tool group: agent tools for client, pet, appointment, slot, arrival match, and wait-status reads.
- Clinic booking tool group: agent tools for appointment booking and scheduler-intake capture.
- Clinic front-desk tool group: agent tools for check-in, pickup, status updates, clinic inbox messages, and triage dispatch.
- Agent clinic data projection: persisted mock clinic/task/approval/report rows shaped for agent runtime input.
- Agent JSON persistence policy: JSON coercion, redaction, truncation, and depth limits for persisted agent runs and tool traces.
- Agent adapter seam: package-local runtime interface for client, pet, appointment, pricing, invoice, records, lab, and messaging operations.
- Mock clinic adapter: deterministic in-memory implementation of the agent adapter seam over mock clinic data.
- Mock clinic lookup: package-local id, loose-match, client, pet, and phone lookup helpers shared by agent tools and mock adapters.
- Arrival appointment match query: normalized last-name, phone, and pet matching for same-day arrival appointments.
- Arrival intake row projection: database row-to-contract mapping for Arrival settings, rooms, intakes, and matched appointments.
- Arrival room persistence: default room setup, room assignment, room state updates, checkout, and cleaning auto-open rules.
- Arrival intake request: public/staff query auth, public match/submit validation, Arrival exception creation, room updates, checkout, arrival settings mutation, and HTTP response mapping.
- Arrival intake browser adapter: browser request payloads and response normalization for public Arrival settings, identity match, and questionnaire submit.
- Arrival intake flow state: customer autofill, step transitions, matched arrival state, questionnaire state, errors, and loading state.
- Arrival answer projection: browser answer defaults, Visit reason inference, reason-specific field rendering, and submit payload shaping for Arrival questionnaire.
- Arrival desk browser adapter: browser request payloads and response normalization for Arrival Desk snapshot, room, checkout, and settings mutations.
- Arrival desk state: browser polling, room-to-arrival projection, settings drafts, room updates, checkout, and Arrival questionnaire saves.
- Mock clinic snapshot query: aggregate persisted mock clinic clients, pets, appointments, slots, followups, invoices, messages, pricing, and lab data for agent runtime input.
- Mock clinic request: manager-authenticated fixture snapshot and reset route behavior for demos/scenarios.
- Mock clinic row projection: database row-to-contract mapping for mock clinic clients, pets, appointments, pricing, and lab data.
- Mock clinic pricing row projection: database row-to-contract mapping for service catalog rows and competitor pricing observations.
- Pricing agent data: service catalog and competitor observations loaded from the mock clinic snapshot, with scan results kept in runtime data and pricing reports persisted as agent reports.
- Mock clinic lab row projection: database row-to-contract mapping for lab catalog, lab order, and lab result rows.
- Agent effect persistence: rules that turn agent draft tasks, reports, approvals, workflow events, and tool-call audit into persisted state.
- Operational mutation persistence: rules that turn successful state-changing agent tool calls into mock clinic state changes and linked workflow events.
- Public agent ingress: public workflow request validation, rate limiting, duplicate detection, and guard-event writes before agent execution.
- Agent workflow route map: app route slug, auth mode, route intent normalization, and fallback event intent projection.
- Agent email workflow: manager-authenticated email campaign validation, confirmation blockers, notification send, run persistence, decision persistence, and tool-call audit.
- Agent email completion projection: shared email capability constants, completed-run output payload, and route response shape.
- Report route adapter: manager-authenticated report listing route shell with report-specific data payloads.
- API response helper: no-store response headers, structured route logging, and shared database/server error responses.
- Veterinarian profile: notification delivery preferences, passcode identity, display name, and actor-reference history.
- Task board projection: role-specific lane membership, visible actions, counts, and display policy for clinic tasks.
- Task board state projection: blank/edit task form mapping and actor-name reconciliation for optimistic task-board state.
- Task board browser state: local session persistence, task cache invalidation, cross-tab sync payloads, and active-polling timing for the task board.
- Task board browser adapter: browser request payloads, auth-error interpretation, and response normalization for task board reads/mutations.
- Task board settings browser adapter: browser request payloads and response projection for notification settings, recipient profiles, and profile-name saves.
- Task board form state: browser create/edit modal state, blank/edit projection, save request, refresh, sync, errors, and toast.
- Task board mutation actions: browser side-effect rules for status, archive, escalation, undo, refresh, toast, and completion confetti.
- Task board overlays: browser invalid-task modal and undoable toast rendering for task-board mutations.
- Task audit event request: task audit event read auth, permission logging, and tenant-scoped event query.
- Task board profile-name state: browser optimistic session rename, server save, actor-reference reconciliation, settings sync, toast, and rollback.
- Admin task snapshot: browser polling, active-task filtering, dashboard stats, and new-task counts for the admin Tasks tab.
- Admin Tasks tab: browser rendering for admin task stats, active queue rows, manual refresh, and internal-agent quick actions.
- Team account panel: admin browser flow for creating clinic team accounts, showing one-time passwords, and listing activation status.
- Approval request: manager approval listing auth/query parsing, create/decision payload validation, manager auth, approval persistence, and HTTP response mapping.
- Approval queue browser adapter: browser request payloads and response normalization for manager approval listing and approve/reject mutations.
- Approval queue state: stored task-board session load, approval list state, saving state, errors, and refresh after decisions.
- Browser phone text: shared browser phone digit extraction, input formatting, SMS readiness, and display formatting.
- Settings request: settings access validation, notification setting projection, veterinarian profile mutation, profile-name normalization, actor-reference rename side effects, update logging, and HTTP response mapping.
- Task board settings state: notification settings loading, end-of-day alert toggles, veterinarian profile saves/deactivation, and settings sync signalling.
- Task board settings UI: veterinarian notification profile controls and end-of-day alert panel for the task board.
- Admin assistant chat state: browser messages, quick-action loading, internal-agent sends, and post-agent task refresh.
- Profile-name request: profile-name payload/auth validation, actor display-name update, doctor-name normalization, veterinarian profile sync, task/audit actor-reference rename side effects, update logging, and HTTP response mapping.
- Task list request: query auth, include-archived parsing, read-side completed-task archive cutoff, role-scoped task query, no-store response, and staff-safe projection.
- Task visibility projection: role-specific task response shaping that hides staff-unsafe actor details.
- Task transition persistence: status moves, completion/invalid/archive/undo/escalation writes, and transition audit metadata.
- Task audit persistence: task event writes, task event listing, and audit metadata JSON shape.
- Task write projection: task create/edit input normalization and SQL insert/patch row shaping.
- Task row projection: database row-to-contract mapping for task rows and task audit events.
- Agent decision row projection: database row-to-contract mapping for durable agent decisions.
- Agent row projection: database row-to-contract mapping for agent runs, workflow events, approvals, reports, and tool calls.
- Agent timeline query: read-side agent run, workflow event, approval, report, and tool-call listing plus run timeline assembly.
- Agent audit request: manager auth, decision filter parsing, run timeline lookup, not-found handling, and no-store response mapping.
- Agent memory row projection: database row-to-contract mapping for durable agent memories and search scores.
- Agent memory request: manager auth, memory query parsing, create/correction/delete validation, actor metadata, DB calls, no-store response mapping, and response projection.
- Browser actor projection: shared actor body projection, manager read query strings, and passcode read headers for browser routes.
- Agent audit browser adapter: browser request payloads and response projection for staff agent decisions and memory writes.
- Staff agent email controls: browser email-mode, cadence, confirmation, and delay state plus email payload shaping for the internal-agent console.
- Staff agent result panel: browser rendering for internal-agent result metadata, blockers, email send results, and decision ids.
- Staff agent audit state: browser decision/memory loading, memory edits, audit errors, and refresh timing for the internal-agent console.
- Staff agent audit panel: browser rendering for internal-agent decisions, durable memory edits, and audit refresh actions.
- Public agent flow config: workflow-keyed public form titles, prompts, placeholders, submit labels, and optional fields.
- Public agent browser adapter: route mapping, browser request payloads, and response projection for public workflow forms, customer chat, and staff chat.
- Agent chat browser state: browser message list, loading state, user/assistant message projection, error fallback, and post-agent success hooks for customer/staff chat.
- Chat report card: inline agent report summary and expandable report-detail rendering for chat messages.
- Public agent result panel: browser summary rendering for public workflow outputs, task ids, approval ids, run ids, and agent result facts.
- Notification content: HTML/text rendering for escalation, daily priority summary, smoke, and agent-example notifications.
- Notification request: cron authorization, notification mode normalization, environment recipient-list parsing, daily/monthly/smoke notification send behavior, logging, and HTTP response mapping.
- Notification delivery planning: mode, channel, recipient, timezone, and opt-in target selection for notification sends.
- Notification send pipeline: idempotency keys, notification attempt lifecycle, Resend transport, and per-recipient send results.
- Auth request: passcode actor payload validation, clinic resolution, actor authentication, rejection logging, and no-store auth response mapping.
- Account auth browser adapter: browser request payloads and validation-state projection for passcode-backed `/api/auth` checks.
- Account auth shell: portal brand panel, account tab selection, team account server-auth bridge, and routing between customer and staff auth forms.
- Mock account model: browser demo account types, localStorage keys, and built-in demo account constants.
- Mock account store: browser demo account persistence, email normalization, OTP reset, and team account lifecycle.
- Account session store: browser account-session persistence and demo passcode bridging for task-board manager routes.
- Customer auth form: pet-owner login/signup state and local account-store calls.
- Staff auth form: clinic-team login, one-time-password redemption, and local account-store calls.
- Auth code input: reusable uppercase one-time/reset code input formatting.
- Auth password input: reusable password visibility toggle and autocomplete policy.
- Scenario data: HTTP scenario definitions, seeded request bodies, expected tools, and safety assertions for VetAgent route proof.
