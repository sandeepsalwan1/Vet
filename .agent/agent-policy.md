# Agent Policy

## Priority

- `priority:high`: real clinic operation impact, user-visible workflow risk, security/auth/data changes, billing, migrations, production data, or product-policy decisions. Human review required.
- `priority:low`: small cleanup, test coverage, docs, obvious UX copy, or low-risk maintenance. Cheapest automation path.
- no priority label: medium.

## Risk

- low: docs, tests, obvious validation, narrow UI polish, or isolated package logic with focused proof.
- medium: app behavior changes with tests or scenario proof.
- high: secrets, auth, billing, migrations, production data, external integrations, destructive operations, broad refactors, unclear product decisions, or any change that cannot be proven automatically.

High risk sets `agent:blocked` or removes `agent:automerge`.

## Automerge

Automerge is allowed only when all are true:

- PR has `agent:automerge`.
- PR is not `priority:high`.
- computed risk is low or medium.
- CI required checks pass.
- reviewer status is passing.
- no-mistakes status is passing.
- required proof is present.
- no unresolved human question remains.

Automerge is forbidden for high-priority or high-risk work even if all checks pass.

## Proof And GIFs

- Default proof is text/CI proof.
- UI proof runs only when UI behavior changed or `agent:proof` exists.
- GIF/video proof runs only when issue or PR text explicitly asks for it.
- Visual artifacts stay local or in GitHub Actions artifacts unless the destination is explicitly approved.
- Never upload screenshots/GIFs to public hosts, social media, or unapproved AI/vision services.

## Worker Routing

- GitHub Actions owns label events and CI status.
- Crabbox is preferred for implementation/proof when provider auth exists.
- A provider is eligible only after a live smoke passes and its repository readiness variable is enabled.
- GitHub-hosted Actions is the fallback for non-visual work when provider auth is missing.
- The raw `crabbox` binary is not the issue brain; the worker script plus configured backend is.
- Codex/OpenAI is one backend choice, not the control plane.
- Sandcastle is optional inside a worker when TypeScript orchestration would simplify planner/reviewer flows.

## Gate Trust

- Hosted no-mistakes runs only for same-repository `agent/issue-*` branches with trusted implementation metadata and managed triage.
- Hosted no-mistakes validates an immutable exact head and skips its private rebase, push, PR, and CI mutation stages.
- A separate credential-free step runs the trusted offline test baseline before model auth; no-mistakes Codex stays read-only, and unpublished source changes fail the gate.
- Configured deterministic scenario, API, and CLI checks count as direct non-visual evidence when they exercise the trusted request.
- Repository commands run without normal credential inheritance, but the shared runner identity is defense in depth rather than hostile-code isolation.
- `ask-user`, malformed output, setup failure, or a stale validated head blocks automerge.
- An eligible stale branch is updated by the trusted automerge workflow, then all head-bound CI and review gates run again before merge.
