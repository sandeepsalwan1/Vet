# AGENTS.md

Next.js app shell and route pages.

## Rules

- Keep page files as thin adapters around components.
- Public workflow pages use `PublicAgentFlow`; `/request` uses `RequestForm`.
- Staff pages route through `AppRoot`, `TaskBoard`, `StaffAgentConsole`, or `ApprovalQueue`.
- App-wide CSS stays in `globals.css`; prefer existing class tokens before adding new ones.
- Do not put business rules in `page.tsx` files.
