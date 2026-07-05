# AGENTS.md

Agent email route modules.

## Rules

- `route.ts` is auth/guard/delegate only.
- `_emailWorkflow.ts` owns run lifecycle, persistence, notification send, response contract, and failure finalization.
- `_emailCompletion.ts` owns email capability constants and shared completed-run output/response projection.
- `_emailCampaign.ts` owns request schema, recipient extraction, cadence/audience inference, confirmation blockers, and send stats.
- Keep production sends confirmation-gated.
- Do not log passcodes, recipients beyond counts, tokens, or transport credentials.
