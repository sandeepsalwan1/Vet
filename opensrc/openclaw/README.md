# OpenClaw Crabbox Usage

Source: https://github.com/openclaw/openclaw

Current checked state, refreshed on 2026-07-20:

- checked upstream `main`: `3d841472bd0efebabfd0247a1509df396c1fa314`
- latest public release at refresh time: `v2026.7.1`
- upstream package state at refresh time: `2026.7.2`
- license: MIT

Use in this repo:

- reference for running repository validation through Crabbox instead of making Crabbox the agent brain
- reference for a repo-owned `.crabbox.yaml`, provider-specific hydration, cache policy, and one-shot cleanup
- reference for resolving a sibling Crabbox binary before PATH
- reference for reporting the actual provider and lease rather than an intended provider

OpenClaw currently defaults remote proof to delegated Blacksmith Testbox and keeps direct providers as explicit overrides.
Vet keeps its smaller GitHub issue state machine, uses ready credentialed providers when available, and uses Crabbox `local-container` for credential-free visual proof.

Do not vendor the full OpenClaw source here.
Refresh this note from the public upstream repository when Crabbox integration decisions depend on its current wrapper or configuration.
