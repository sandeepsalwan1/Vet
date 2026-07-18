# HTTP Boundary

Routes authenticate, validate, delegate, and map stable responses. Request modules own workflow sequencing.

## Invariants

- Resolve clinic/tenant and actor authorization before tenant-owned reads or writes.
- Validate request shape at the edge.
- Send manager passcodes in headers for reads or actor JSON for writes, never query strings.
- Use shared no-store, structured logging, and database/server error helpers.
- Keep role-safe projection between persistence and HTTP responses.
- Routes remain thin even when only one route currently calls the request module.
- Redact passcodes, tokens, recipients, contact details, and tool data before logs or persistence.

## Domain Safety

- Public agent routes cannot expose manager workflows or staff data; manager routes require authenticated actors.
- Agent email production sends remain confirmation-gated.
- Memory corrections create a replacement fact rather than rewriting the original history.
- Arrival matching creates an Arrival exception unless one safe appointment match exists.
- Settings changes that affect the clinic require Admin; veterinarians may edit only their own profile.
- Staff cannot delete or archive veterinarian-owned clinical tasks; enforce this in the route or workflow, not only the UI.
- Task changes must preserve role-safe projection and add regression proof for archive, undo, escalation, duplicate, or rate-limit behavior.
- Reuse shared task, veterinarian-name, auth, and response policy instead of duplicating it in routes.

## Main Seams

- `_shared.ts`: actor auth and clinic resolution.
- `_apiResponse.ts`: no-store responses, logging, and shared failures.
- `agent/[workflow]/route.ts`: dynamic adapter into workflow mapping and the runner.
- Adjacent `_*Request.ts` modules: route-specific orchestration and response mapping.
