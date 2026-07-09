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
2. Triage uses a schema-constrained Codex result, then applies managed labels/comments.
3. Implementation runs Codex without write credentials, uploads a patch, then applies it in a separate write-token job and opens a draft PR.
4. Review repeats the read/patch separation, publishes `agent-review`, and invokes no-mistakes.
5. Proof runs configured commands and records provider/artifact evidence when remote visual proof is required.
6. Automerge marks an eligible draft ready and enables GitHub automerge only after configured checks and statuses pass.

## Trust Boundaries

- Keep baseline CI separate from agent workflows.
- Pass the OpenAI key only to `openai/codex-action`, never as job-level environment.
- Keep GitHub write tokens out of Codex jobs; validation commands run with GitHub token variables removed.
- Codex Action author gates allow the repository owner and `github-actions[bot]`; cross-repository PR review is rejected before Codex runs.
- High-risk or high-priority work requires human review.
- A missing provider, artifact, or lease blocks required visual proof; it does not fake success.
- no-mistakes and proof statuses must reflect real execution.

## Gates

Normal automerge requires CI checks `quality`, `build`, and `scenarios`, plus `agent-review` and `no-mistakes` statuses. `agent-proof` is also required while the PR carries `agent:proof`. `.agent/config.json` is the machine-readable source for configured names; `.agent/agent-policy.md` owns risk and approval meaning.

## Commands

Mutating automation CLIs support `--dry-run`; structured workflow calls use `--json`. `agent-router.mjs` is read-only and can route a saved event without GitHub mutation.

    node scripts/agent-labels.mjs --dry-run --json
    node scripts/agent-router.mjs --event-file event.json --json

GitHub comments use managed markers and temporary body files. Never interpolate untrusted issue text into a shell command.
