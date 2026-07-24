# Agent Policy

## Priority

- `priority:high`: real clinic operation impact, user-visible workflow risk, security/auth/data changes, billing, migrations, production data, or product-policy decisions. Human review required.
- `priority:trivial`: owner-selected trivial low-risk work. Add before `agent:implement`; skip only the paid no-mistakes model gate while retaining triage, exact-head CI, independent review, requested proof, and automerge policy.
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
- no-mistakes status is passing, unless the pre-model validation artifact, immutable PR commit seal, and the current source issue and PR all contain `priority:trivial`.
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
- Triage is a deterministic zero-model intent seal; routine ambiguity passes to the implementer for repository-grounded judgment.
- Crabbox is preferred for implementation/proof when provider auth exists.
- A provider is eligible only after a live smoke passes and its repository readiness variable is enabled.
- Crabbox `local-container` is the credential-free exception for explicit visual proof on a GitHub runner; it receives no provider credentials and must produce the same authentic route-bound artifacts or fail closed.
- GitHub-hosted Actions is the fallback for non-visual work when provider auth is missing.
- The raw `crabbox` binary is not the issue brain; the worker script plus configured backend is.
- Codex/OpenAI is one backend choice, not the control plane.
- Default each lane to the cheapest model and reasoning level that reliably satisfies its contract; raise either only after measured failure.
- Sandcastle is optional inside a worker when TypeScript orchestration would simplify planner/reviewer flows.

## Gate Trust

- Hosted no-mistakes runs only for same-repository `agent/issue-*` branches with trusted implementation metadata and managed triage.
- Hosted no-mistakes validates an immutable exact head and skips its private rebase, push, PR, and CI mutation stages.
- A separate credential-free step runs the trusted offline test baseline before model auth.
- no-mistakes Codex receives a writable isolated worktree without GitHub credentials and runs each model stage directly without nested tools or full repository validation commands.
- Native safe fixes cross into the credentialed publisher only as a sealed patch whose digest, paths, exact base head, and fixed tree are verified before an exact force-with-lease.
- The gate rejects binary native fixes and any patch containing an exact credential value from its environment.
- Every published native fix starts fresh exact-head CI, independent review, and no-mistakes validation.
- Unpublished candidate-checkout changes fail the gate.
- Configured deterministic scenario, API, and CLI checks count as direct non-visual evidence when they exercise the trusted request.
- Repository commands run without normal credential inheritance, but the shared runner identity is defense in depth rather than hostile-code isolation.
- `ask-user`, setup failure, or a stale validated head blocks automerge by default.
- Malformed evaluator output receives one exact-head infrastructure retry, then blocks if the retry also fails.
- A manual rerun may carry explicit user approval only for its immutable expected head; later heads and ordinary runs still block on `ask-user`.
- A passing approved rerun removes the blocked label and restores automerge for that head.
- `priority:trivial` can bypass no-mistakes only when it was sealed before model execution, remains in immutable PR commit ancestry, and remains on the issue and PR.
- An eligible stale branch is updated by the trusted automerge workflow, then all head-bound CI and review gates run again before merge.
