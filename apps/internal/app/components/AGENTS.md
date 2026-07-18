# Browser UI Boundary

Components render public flows, authentication, staff tasks, approvals, settings, and agent consoles.

## Rules

- Keep state close to the screen that owns it; extract a hook/helper when it hides real sequencing or serves repeated callers.
- Put request payloads, auth headers, and response/error normalization in browser adapters. Do not scatter direct fetches through components.
- Components compose UI; domain workflow and persistence policy belong in app helpers, request modules, or packages.
- Customer account context never authorizes manager routes. Staff/admin surfaces must validate server-backed credentials before rendering protected data.
- Keep login errors from revealing whether a live secret or account exists.
- Keep client-facing agent language within medical-safety guardrails.
- Never hard-code live credentials, recipients, passcodes, or transport settings.
- Reuse existing classes/tokens in `app/globals.css` and preserve accessible loading, error, and disabled states.
- Add focused proof for changed browser state or workflow behavior; use live browser validation when visual interaction changes.

## Product Roles And UX

- Staff means front desk/cashier. Keep its default surface minimal: daily tasks, payments, arrivals, and on-demand room controls.
- Veterinarian is a distinct clinical role with a staff-like task flow plus clinical ownership. Staff cannot delete or archive veterinarian-owned clinical tasks.
- Admin means hospital owner/manager. Put clinic-wide settings, client outreach, notification automation, and reporting there rather than on staff or veterinarian screens.
- UI must be terse and self-explanatory without a training video. Reveal dense controls only when needed; show only current actionable state.
- Before material UI work, disclose changed and unchanged screens with light mockups; plan approval never covers undisclosed surfaces.
- Prefer automatic operational updates; do not make manual refresh the primary workflow.
- Build real product surfaces behind PIMS-ready seams, not presentation-only demos. AVImark or Cornerstone approval should require an adapter, not a UI or workflow redesign.
