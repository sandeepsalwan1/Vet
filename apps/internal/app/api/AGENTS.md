# AGENTS.md

HTTP adapter layer.

## Rules

- Authenticate/derive actor before mutation.
- Resolve clinic/tenant before persistence.
- Validate request shape at the route edge.
- Accept manager passcodes from headers or JSON actor bodies, not query strings.
- Keep workflow rules out of route files when they need tests or reuse.
- Import task permissions from `../lib/taskWorkflow`, not `_shared.ts`.
- Return stable JSON contracts documented in `docs/agent-route-contracts.md`.
- Use package modules for DB, notification, client-request, and agent behavior.

## Key Seams

- `_shared.ts`: actor auth, manager auth, clinic resolution.
- `_apiResponse.ts`: no-store headers, structured route logging, database/server error responses.
- `auth/_authRequest.ts`: passcode actor validation, authentication, logging, and response mapping module.
- `agent/_workflowRoutes.ts`: agent route slug mapping, auth mode, and route-intent normalization.
- `agent/_runner.ts`: workflow execution and persistence orchestration.
- `agent/_auditRequest.ts`: agent decision list and run timeline manager-auth response module.
- `arrival-intake/_arrivalIntakeRequest.ts`: public/staff arrival auth, validation, mutation, and response mapping module.
- `approvals/_approvalRequest.ts`: approval list/create/decision auth, validation, persistence, and response mapping module.
- `events/_eventRequest.ts`: task audit event read auth, permission logging, and query module.
- `tasks/_taskListRequest.ts`: task list auth, query parsing, archive cutoff, role-scoped query, and projection module.
- `tasks/_taskVisibility.ts`: staff-safe task projection module.
- `tasks/_taskCreateRequest.ts`: task create auth, validation, guard, insert, and response projection module.
- `tasks/[id]/_taskUpdateRequest.ts`: task update auth, validation, workflow, persistence, notification, and response projection module.
- `tasks/[id]/undo/_taskUndoRequest.ts`: task undo manager auth, persistence, logging, and response projection module.
- `settings/_settingsRequest.ts`: settings auth, projection, veterinarian profile mutation, logging, and response mapping module.
- `profile-name/_profileNameRequest.ts`: profile-name auth, display-name update, reference rename, logging, and response mapping module.
- `notifications/_notificationRequest.ts`: cron auth, notification mode/env parsing, daily/monthly/smoke send, logging, and response mapping module.
- `mock/clinic/_mockClinicRequest.ts`: manager-auth mock clinic snapshot and reset module.
- `reports/_reportRoute.ts`: manager-auth report route adapter.
- `agent/memory/_memoryRequest.ts`: agent memory manager auth, query/mutation handling, and response mapping module.
