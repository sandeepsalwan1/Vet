# Agent Workflows

- Root exports expose app-facing workflow runners, runtime configuration, and contracts only.
- Keep Google ADK code behind `./adk-runtime`; deterministic/mock execution must work without Google credentials.
- Centralize runtime mode, credential-state, and model policy; do not repeat env checks in callers.
- Keep workflow schemas/result contracts separate from mock-clinic data contracts.
- Define runtime operation interfaces in the package and keep concrete mock behavior behind adapters.
- Put tools in one domain-owned group, then compose them through the registry. Do not create cross-domain grab bags.
- Tool names are stable model-facing contracts; side effects must be explicit and return structured results.
- Keep package code independent of app routes and browser UI.
- Redact and bound persisted tool traces.
- Update `src/scenarioRunner.ts` when behavior, tool names, or external/internal allowlists change.
