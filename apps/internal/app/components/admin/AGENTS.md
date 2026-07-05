# AGENTS.md

Admin dashboard modules.

## Rules

- Admin account sessions must be server-authenticated before manager routes render.
- If account passcode auth is rejected, fall back to the passcode task board.
- Use `agentClient.ts` and `taskBoardClient.ts`; do not fetch manager routes directly.
- Admin task polling/new-count state lives in `useAdminTaskSnapshot.ts`.
- Admin Tasks tab stats, queue rows, refresh button, and quick-action controls live in `AdminTasksTab.tsx`; `AdminDashboard.tsx` owns shell tabs.
- Admin assistant quick-action loading and post-agent task refresh live in `useAdminAssistantChat.ts`; shared chat lifecycle lives in `../useAgentChatSession.ts`.
- Team-account creation and one-time password display live in `TeamAccountPanel.tsx` until real server account auth exists.
