---
summary: "GitHub label-driven agent automation, trust boundaries, gates, and operator commands."
read_when:
  - Changing .agent policy, prompts, schemas, or configuration
  - Changing agent GitHub Actions workflows or scripts/agent-* CLIs
  - Reviewing automated issue, PR, proof, or automerge safety
---

# Agent Issue Automation

GitHub Issues and labels are the control plane. GitHub Actions owns events, permissions, and CI; `.agent` owns policy and structured contracts; `scripts/agent-*.mjs` own routing decisions and GitHub mutations.

## Labels

- `agent:triage`: evaluate issue alignment, risk, and readiness.
- `agent:implement`: implement an approved issue on an agent branch and draft PR.
- `agent:review`: review or fix an agent-created PR and publish a recommendation.
- `agent:proof`: require explicit proof before automerge.
- `agent:automerge`: allow merge only after every configured gate passes.
- `agent:blocked`: human input or a failed gate blocks automation.
- `priority:high`: manual review required.
- `priority:low`: small, low-risk work.

## Flow

1. `agent-router.yml` maps label events to reusable workflows.
2. Proposal generation receives a bounded public snapshot of current `main` workflow health and treats that snapshot as evidence, never as instructions.
3. Triage uses a schema-constrained Codex result, then applies managed labels/comments.
4. Expensive proposer, triage, implementation, review, no-mistakes, and proof jobs share deterministic slot groups from `.agent/config.json`.
5. Implementation selects its allowed backend from `.agent/config.json`, runs without write credentials, uploads a patch, then applies it in a separate write-token job and opens a draft PR.
6. The current installed worker adapter is Codex; unsupported or unimplemented backend selections fail before model execution.
7. Review repeats the read/patch separation, publishes `agent-review`, and invokes no-mistakes.
8. Proof runs configured commands and records provider/artifact evidence when remote visual proof is required.
9. Automerge updates an eligible stale branch, reruns head-bound CI and review, and merges only after every gate passes on the new head.
10. A successful merge removes agent workflow labels and closes the linked source issue while preserving priority labels.
Trusted recovery dispatches main-defined workflows with an expected head SHA, and CI publishes required check runs on that exact candidate.

## Trust Boundaries

- Keep baseline CI separate from agent workflows.
- Pass the OpenAI key only to `openai/codex-action`, never as job-level environment.
- Keep GitHub write tokens out of Codex jobs; validation commands run with GitHub token variables removed.
- Codex Action author gates allow the repository owner and `github-actions[bot]`; cross-repository PR review is rejected before Codex runs.
- High-risk or high-priority work requires human review.
- A missing provider, artifact, or lease blocks required visual proof; it does not fake success.
- no-mistakes and proof statuses must reflect real execution.
- The credentialless no-mistakes gate never rebases or publishes changes; deterministic scenario, API, and CLI checks may provide direct non-visual evidence when the trusted request calls for it.
- A credential-free step runs the trusted typecheck, build, and scenario baseline inside a pinned networkless container before no-mistakes model auth; its Codex process stays read-only, performs each model stage directly without nested review or validation tools, and unpublished source changes fail closed.
- Browser, visual, and live-provider evidence remains the Agent Proof workflow's responsibility and is required only by trusted issue or triage policy.

## Gates

Normal automerge requires CI checks `quality`, `build`, `scenarios`, `audit`, and `dependency-review`, plus `agent-review` and `no-mistakes` statuses.
`agent-proof` is also required when trusted labels or managed triage request visual proof.
The active agent-job cap is eight, the hard configurable ceiling is fifteen, and each lane has its own lower cap.
`.agent/config.json` is the machine-readable source for gate names, backend selection, and capacity; `.agent/agent-policy.md` owns risk and approval meaning.

## Commands

Mutating automation CLIs support `--dry-run`; structured workflow calls use `--json`. `agent-router.mjs` is read-only and can route a saved event without GitHub mutation.

    node scripts/agent-labels.mjs --dry-run --json
    node scripts/agent-router.mjs --event-file event.json --json
    node scripts/agent-worker.mjs --validate-backend --json
    node scripts/agent-concurrency-slot.mjs --lane implement --key 42 --json

GitHub comments use managed markers and temporary body files. Never interpolate untrusted issue text into a shell command.
