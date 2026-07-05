# AGENTS.md

Agent HTTP route layer.

## Rules

- Keep `[workflow]/route.ts` shallow; route path maps to `_runner.ts`.
- `_workflowRoutes.ts` owns workflow slug mapping, auth mode, and route-intent normalization.
- `_runner.ts` owns runtime execution, persistence, fallback events, and response contract.
- `_auditRequest.ts` owns manager auth, decision-list filters, run timeline lookup, and no-store response mapping.
- `_clinicData.ts` owns agent input projection from persisted clinic data.
- `_effectPersistence.ts` owns draft task/report/approval/event persistence.
- `_operationalMutations.ts` owns state changes from successful tool calls.
- Public guards stay in `_publicAgentGuard.ts`; manager guards stay in `_internalAgentGuard.ts` or `../_shared.ts`.
- `email/_emailWorkflow.ts` owns email run lifecycle, decision persistence, tool-call audit, and response contract.
- Keep email campaign validation in `email/_emailCampaign.ts`, not the route body.
- `memory/_memoryRequest.ts` owns agent memory manager auth, query/mutation handling, and response mapping.
- Redact secrets before persistence and logs.
