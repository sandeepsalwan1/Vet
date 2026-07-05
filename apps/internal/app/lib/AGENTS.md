# AGENTS.md

Internal app helper modules.

## Rules

- Keep browser request/error normalization in `apiClient.ts`.
- Keep agent workflow/console calls in `agentClient.ts`; staff audit/memory calls live in `agentAuditClient.ts`.
- Keep browser actor body/query/header projection in `browserActor.ts`.
- Keep phone input/display normalization in `phoneText.ts`.
- Keep `/api/auth` browser payloads and validation-state mapping in `authClient.ts`.
- Keep `/api/clinic` browser reads and default brand fallback in `clinicClient.ts`.
- Keep account types/demo constants in `accountModel.ts`.
- Keep mock account email normalization inside `accountStore.ts`; do not duplicate lower/trim logic in forms.
- Keep account session/passcode bridging in `accountSessionStore.ts`; export it through `accountStore.ts` for callers.
- Keep task status/action rules in `taskWorkflow.ts`.
- Keep veterinarian profile naming and ids in `veterinarianProfile.ts`.
- Avoid React imports here unless the helper is intentionally UI-specific.
- Do not store or log secret values.
