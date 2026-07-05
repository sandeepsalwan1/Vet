# AGENTS.md

Agent implementation modules.

## Rules

- Workflow modules return `AgentWorkflowResult`; app routes own HTTP response shape.
- Shared agent vocabulary lives in `agentVocabulary.ts`; import it from there when workflow, tools, or mock-clinic contracts need stable names.
- Workflow schemas/result contracts live in `contracts.ts`; mock clinic data shapes live in `mockClinicContracts.ts`.
- Runtime env selection lives in `runtimeConfig.ts`; do not duplicate Google credential/model checks.
- Tool registry composition stays in `tools.ts` and `toolCore.ts`.
- Adapter interfaces live in `adapters.ts`; concrete mock mutation behavior lives in `mockClinicAdapters.ts`.
- Mock clinic lookup/id helpers live in `mockClinicLookup.ts`; import through `toolCore.ts` only when a tool group needs legacy helper exports.
- Domain tools live under `toolGroups/`; do not add cross-domain tool files.
- ADK adapter code stays in `adk*.ts` and must keep deterministic/mock runtime usable without Google credentials.
- Scenario coverage in `scenarioRunner.ts` guards tool allowlists and user-visible workflow behavior.
