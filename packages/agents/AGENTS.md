# AGENTS.md

Agent workflow package.

## Shape

- `src/*Agent.ts`: workflow modules.
- `src/agentVocabulary.ts`: shared agent intent/mode/task vocabulary.
- `src/contracts.ts`: workflow schemas and result contracts.
- `src/mockClinicContracts.ts`: mock clinic data contracts consumed by tools/adapters.
- `src/toolGroups`: domain-owned tool definitions.
- `src/tools.ts` and `src/toolCore.ts`: shared tool registry/runtime.
- `src/runtimeConfig.ts`: runtime mode, Google credential state, and model-name policy.
- `src/adkRuntime.ts`: Google ADK execution module.
- `src/adkAgents.ts` and `src/adkTools.ts`: ADK adapter construction.

## Rules

- Package root exports only app-facing workflow runners and contracts.
- Export runtime config helpers from the root when app route code needs resolved mode/model state.
- Keep deterministic/mock paths usable without Google credentials.
- Keep Google ADK exports behind `./adk-runtime`; do not export them from package root.
- Add tools to a domain tool group first, then compose through the registry.
- Persist only redacted/truncated tool traces.
- Scenario changes should update `src/scenarioRunner.ts` coverage.
