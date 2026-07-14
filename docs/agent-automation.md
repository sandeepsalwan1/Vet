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

Cost-sensitive routing lives in `.agent/config.json`.
Proposal and triage use GPT-5.4 nano; implementation, review, and no-mistakes use GPT-5.4 mini; all lanes currently use low reasoning.
Increase a lane's model or reasoning only after measured contract failures.

## Operate The Loop

Set the repository once for the shell session.

```bash
REPO=sandeepsalwan1/Vet
```

Confirm the required label set and OpenAI secret name without printing a secret value.

```bash
node scripts/agent-labels.mjs --dry-run --json
gh secret list --repo "$REPO" | awk '$1 == "OPENAI_API_KEY" { print $1 }'
```

Run `node scripts/agent-labels.mjs --json` only when the label dry-run reports drift.

### Start From A New Issue

Write the complete request, acceptance criteria, and proof needs in a temporary file.

```bash
${EDITOR:-vi} /tmp/vet-agent-issue.md
gh issue create \
  --repo "$REPO" \
  --title "<clear outcome>" \
  --body-file /tmp/vet-agent-issue.md \
  --label agent:triage
```

That one label starts the normal plan path.
Triage reads `VISION.md`, repository policy, current issue state, and architecture docs.
An aligned low-risk result adds `agent:implement` and `agent:automerge`, then dispatches implementation automatically.
Implementation creates `agent/issue-<number>-<slug>`, validates the patch, opens or updates a draft PR, starts exact-head CI, and starts review.
Review can apply a safe patch, requests proof when needed, publishes `agent-review`, then starts no-mistakes.
Automerge waits for every configured gate, updates a stale branch from `main`, reruns head-bound gates, merges, closes the source issue, and removes workflow labels.

For an existing issue, start the same path with:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label agent:triage
```

If the issue has already been manually reviewed and is clearly aligned, the owner may start implementation directly:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label agent:implement
```

Do not use the direct implementation label to bypass a real product, risk, security, migration, or data decision.

### Ask The Proposer For Candidates

The proposer is manual and bounded by default.

```bash
gh workflow run agent-propose.yml --repo "$REPO" --ref main
```

It uses the cheapest configured model, creates candidate issues with `agent:triage`, and does not schedule implementation by itself.

### Request Proof

Add proof only when the change is visual or the issue explicitly asks for it.

```bash
gh pr edit <pr-number> --repo "$REPO" --add-label agent:proof
```

CI proof can run on GitHub Actions.
Remote UI or GIF proof requires a provider that passed a live smoke plus the matching readiness variable.
Missing provider readiness blocks required visual proof instead of silently replacing it with weaker evidence.

### Approve One no-mistakes Decision

Use this only after the no-mistakes comment reports `ask-user`, the question is understood, and the user explicitly approves unattended handling.
Approval is not a gate bypass.
The exact-head approval contract lives in `.agent/agent-policy.md`.
It lets no-mistakes use `--yes` for one immutable PR head while CI, review, proof, source-integrity, and automerge rules remain required.

Capture the current head, inspect it, then dispatch the owner-only approved rerun.

```bash
PR=<pr-number>
HEAD_SHA="$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid)"
printf 'Approving no-mistakes for PR #%s head %s\n' "$PR" "$HEAD_SHA"

gh workflow run agent-no-mistakes.yml \
  --repo "$REPO" \
  --ref main \
  -f pr-number="$PR" \
  -f expected-head-sha="$HEAD_SHA" \
  -f approval=true \
  -f intent='Resolve the reported ask-user decision exactly as the user approved. Preserve the linked issue intent, repository architecture, deterministic gates, and fail-closed behavior for every later head.'
```

Only the repository owner can submit `approval=true`.
A passing approved rerun removes `agent:blocked`, restores `agent:automerge`, and asks the automerge workflow to reevaluate that exact head.
Any later commit changes the head SHA and invalidates the approval.
Never reuse approval for a different question or run it preemptively.

### Verify The Result

```bash
gh pr checks "$PR" --repo "$REPO"
gh pr view "$PR" --repo "$REPO" \
  --json state,isDraft,mergeStateStatus,headRefOid,labels,url
gh issue view <issue-number> --repo "$REPO" \
  --json state,labels,url
gh run list --repo "$REPO" --limit 20
```

Successful low-risk completion has these observable results:

- required CI checks pass: `quality`, `build`, `scenarios`, `audit`, and `dependency-review`;
- commit statuses pass: `agent-review` and `no-mistakes`;
- `agent-proof` passes when proof is required;
- the PR is merged and its agent branch is deleted;
- the linked issue is closed;
- temporary `agent:*` labels are removed while priority labels remain.

`agent:blocked` means stop and read the newest managed agent comment.
Fix technical failures, answer real product questions, or use the exact-head approval path only for the specific approved no-mistakes decision.

## Plan Acceptance Map

- Issue control plane: GitHub issue labels plus `agent-router.yml`.
- Cheap proposal and triage: GPT-5.4 nano with low reasoning.
- Remote implementation: Crabbox first after provider readiness; isolated GitHub Actions fallback for non-visual work.
- Optional orchestration reference: Sandcastle demonstrates label-driven AFK orchestration patterns and remains an optional worker adapter.
- OpenClaw execution reference: Crabbox is the remote execution and proof host pattern.
- Implementation and review: separate credentialless model jobs and trusted write jobs, using GPT-5.4 mini with low reasoning.
- Required final gate: exact-head no-mistakes status with default `ask-user` blocking.
- Safe merge: low or medium risk only after CI, review, required proof, and no-mistakes pass.
- Human boundary: high priority, high risk, unclear product decisions, missing required proof, and unapproved `ask-user` results never auto-merge.
- Cost boundary: eight active jobs by default, fifteen hard maximum, no scheduled implementation, and visual infrastructure only when explicitly needed.

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
`.agent/config.json` is the machine-readable source for gate names, lane-specific model settings, backend selection, and capacity; `.agent/agent-policy.md` owns risk and approval meaning.

## Commands

Mutating automation CLIs support `--dry-run`; structured workflow calls use `--json`. `agent-router.mjs` is read-only and can route a saved event without GitHub mutation.

    node scripts/agent-labels.mjs --dry-run --json
    node scripts/agent-router.mjs --event-file event.json --json
    node scripts/agent-worker.mjs --validate-backend --lane implement --json
    node scripts/agent-concurrency-slot.mjs --lane implement --key 42 --json

GitHub comments use managed markers and temporary body files. Never interpolate untrusted issue text into a shell command.
