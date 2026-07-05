# AGENTS.md

Unified Next.js app for public flows, staff UI, and agent routes.

## Shape

- `app/api`: route adapters and request auth/validation.
- `app/components`: browser UI modules.
- `app/lib`: browser/app helpers shared inside this app, including profile/name normalization.
- Public pages: `/arrival`, `/booking`, `/pickup`, `/records`, `/followup`, `/call`, `/request`.
- Staff pages: `/staff`, `/staff/agent`, `/staff/approvals`, `/staff/tasks`.

## Rules

- Keep route files thin; push behavior into app-local helpers or packages.
- Use `@central-vet/client-request` for request creation rules.
- Use `@central-vet/agents` for normal agent workflows.
- Use `@central-vet/agents/adk-runtime` only by dynamic import from server code.
- UI dependencies live here, not at repo root.
- Run `npm run lint --workspace @central-vet/internal` after UI/route changes.
