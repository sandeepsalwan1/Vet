# AGENTS.md

Customer portal UI.

## Rules

- Customer account sessions are portal context only; manager routes require staff auth.
- Use `sendCustomerMessage` from `agentClient.ts` for external-agent chat.
- Customer chat context and initial assistant copy live in `useCustomerAgentChat.ts`; shared chat lifecycle lives in `../useAgentChatSession.ts`.
- Keep medical-safety language aligned with external agent guardrails.
- Avoid direct fetches from customer components.
