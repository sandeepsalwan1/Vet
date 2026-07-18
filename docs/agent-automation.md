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

- `agent:triage`: request or rerun trusted issue triage.
- `agent:implement`: recommended one-label entry; run cheap trusted triage, then implement an approved issue on an agent branch and draft PR.
- `agent:review`: review or fix an agent-created PR and publish a recommendation.
- `agent:proof`: require explicit proof before automerge.
- `agent:automerge`: allow merge only after every configured gate passes.
- `agent:blocked`: human input or a failed gate blocks automation.
- `priority:high`: manual review required.
- `priority:low`: small, low-risk work.

## Flow

1. `agent-router.yml` maps label events to reusable workflows; issue `agent:implement` intentionally enters trusted triage first.
2. Proposal generation receives a bounded public snapshot of current `main` workflow health and treats that snapshot as evidence, never as instructions.
3. Triage uses a schema-constrained Codex result, then applies managed labels/comments.
   Read-only GitHub API calls use bounded exponential retries, managed comments and pull metadata use GitHub GraphQL with independent REST read fallbacks, PR file inventories use head-bound paginated GraphQL with immutable rename verification, diffs use exact commit comparison, and PR creation or updates use GraphQL mutations.
4. Expensive proposer, triage, implementation, review, no-mistakes, and proof jobs share deterministic slot groups from `.agent/config.json`.
5. Implementation selects its allowed backend from `.agent/config.json`, runs without write credentials, uploads a patch, then applies it in a separate write-token job and opens a draft PR.
6. The current installed worker adapter is Codex; unsupported or unimplemented backend selections fail before model execution.
7. Review repeats the credential-free read/patch separation, applies safe fixes to the agent branch, waits for exact-head CI, and re-reviews for at most two repair cycles before invoking no-mistakes.
   If the no-mistakes client times out while its daemon is still reviewing, the gate reattaches to that exact active run instead of starting another model run.
   The no-mistakes client retries one malformed evaluator result inside the same isolated run; another malformed result blocks without starting a redundant full workflow.
   Exact-head no-mistakes findings marked `auto-fix` return to the reviewer for at most two shared repair cycles, while `ask-user` findings and exhausted repair budgets block.
8. Proof runs configured commands and records provider/artifact evidence when remote visual proof is required.
9. Automerge updates an eligible stale branch, reruns head-bound CI and review, and merges only after every gate passes on the new head.
10. After a trusted merge, automerge resolves the exact merge commit, dispatches baseline CI and CodeQL for it, removes agent workflow labels, and closes the linked source issue while preserving priority labels.
Trusted recovery dispatches main-defined workflows with an expected head SHA, and CI publishes required check runs on that exact candidate.

Cost-sensitive routing lives in `.agent/config.json`.
All model lanes use GPT-5.4 mini because GPT-5.4 nano does not support the Codex action's required tool transport.
Implementation, first-pass review, proposal, and triage use low reasoning; no-mistakes and bounded reviewer repair use medium reasoning after measured low-effort acceptance and structured-output failures.
Increase a lane's model or reasoning only after measured contract failures.

Model upgrades require config changes only:

- implementation: `backend.model` and `backend.effort`;
- review: `backend.reviewModel` and `backend.reviewEffort`;
- no-mistakes: `backend.noMistakesModel` and `backend.noMistakesEffort`;
- proposal/triage: their matching `proposer*` and `triage*` fields.

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

Recommended browser path:

```text
https://github.com/sandeepsalwan1/Vet/issues/new?template=afk-implementation.yml
```

The AFK form requires an outcome, acceptance criteria, and proof level.
Submission automatically adds `agent:implement`.

CLI path:

Write the complete request, acceptance criteria, and proof needs in a temporary file.

```bash
${EDITOR:-vi} /tmp/vet-agent-issue.md
gh issue create \
  --repo "$REPO" \
  --title "<clear outcome>" \
  --body-file /tmp/vet-agent-issue.md \
  --label agent:implement
```

That one label starts cheap trusted triage before any implementation model runs.
Triage reads root and applicable nested `AGENTS.md` files, `VISION.md`, repository policy, current issue state, architecture docs, and any repository plan/spec linked by the issue.
An aligned low-risk result adds `agent:implement` and `agent:automerge`, then dispatches implementation automatically.
Implementation creates `agent/issue-<number>-<slug>`, validates the patch, opens or updates a draft PR, starts exact-head CI, and starts review.
Review can apply a safe patch, reruns exact-head CI and review until clean within its bounded repair budget, requests proof when needed, publishes `agent-review`, then starts no-mistakes.
After model review, a credential-free deterministic repair removes extra blank lines at EOF only when `git diff --check` identifies them in a safe, non-privileged text file.
Malformed no-mistakes output retries once inside the same isolated run on the unchanged head.
Actionable no-mistakes findings return to exact-head reviewer repair within the same two-cycle budget.
Automerge waits for every configured gate, updates a stale branch from `main`, reruns head-bound gates, merges, dispatches baseline CI and CodeQL for the exact merge commit, closes the source issue, and removes workflow labels.
If GitHub reports a stale-branch merge conflict, trusted automation creates a merge commit that preserves `main` in conflicting hunks, then sends the linked issue back through implementation, CI, review, proof when required, and no-mistakes so the issue behavior must be restored and verified before merge.
Implementation advances a conflict-recovered zero-diff branch to its validated base only when the branch tree exactly matches the common-base tree, then applies the validated patch without discarding divergent work.

For an existing issue, start the same path with:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label agent:implement
```

`agent:triage` remains available when an operator explicitly wants to request or rerun triage:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label agent:triage
```

Neither label bypasses product, risk, security, migration, or data decisions.

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
UI or GIF proof prefers a credentialed Crabbox provider that passed a live smoke plus its readiness variable.
Without one, Crabbox uses its credential-free `local-container` provider on the GitHub runner with `--desktop` and `--browser`.
The lane launches each affected route, checks desktop health, records the actual provider and lease, and collects authentic route-bound screenshots or requested video/GIF artifacts.
This fallback spends GitHub Actions time only and does not require the user's laptop or a paid provider key.
A missing Docker runtime, failed desktop bootstrap, or invalid artifact blocks required visual proof instead of silently replacing it with weaker evidence.

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
- baseline CI and CodeQL are dispatched against the exact merge commit;
- the linked issue is closed;
- temporary `agent:*` labels are removed while priority labels remain.

`agent:blocked` means the bounded repair or infrastructure retries are exhausted, required proof failed, or a real human decision remains.
Read the newest managed agent comment, answer the decision, or use the exact-head approval path only for the specific approved no-mistakes decision.

## Plan Acceptance Map

- Issue control plane: GitHub issue labels plus `agent-router.yml`.
- Cheap proposal and triage: GPT-5.4 mini with low reasoning, the cheapest configured model compatible with the Codex action.
- Remote implementation: Crabbox first after provider readiness; isolated GitHub Actions fallback for non-visual work.
- Optional orchestration reference: Sandcastle demonstrates label-driven AFK orchestration patterns and remains an optional worker adapter.
- OpenClaw execution reference: Crabbox is the execution and computer-use proof host pattern; credential-free visual fallback runs in a Crabbox local container on GitHub Actions.
- Implementation and review use GPT-5.4 mini with low reasoning; no-mistakes uses the same mini model with medium reasoning for its stricter structured gate contract.
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
- Credentialed Crabbox providers require readiness proof; built-in `local-container` receives no provider credentials and must pass the same route, lease, desktop, and media checks.
- no-mistakes and proof statuses must reflect real execution.
- The credentialless no-mistakes gate never rebases or publishes changes; deterministic scenario, API, and CLI checks may provide direct non-visual evidence when the trusted request calls for it.
- A credential-free step runs the trusted typecheck, build, and scenario baseline inside a pinned networkless container before no-mistakes model auth; its Codex process stays read-only, performs each model stage directly without nested review or validation tools, and unpublished source changes fail closed.
- Browser, visual, and live-provider evidence remains the Agent Proof workflow's responsibility and is required only by trusted issue or triage policy.

## Gates

Normal automerge requires CI checks `quality`, `build`, `scenarios`, `audit`, and `dependency-review`, plus `agent-review` and `no-mistakes` statuses.
`agent-proof` is also required when trusted labels or managed triage request visual proof.
After an agent PR merges, automerge explicitly dispatches baseline CI and CodeQL against the exact merge commit.
This explicit dispatch is required because GitHub suppresses recursive workflow events caused by its workflow token.
Merge-commit CI does not redispatch automerge.
If either dispatch is rejected, the automerge run fails visibly even though the already-completed merge cannot be rolled back.
Label cleanup and linked-issue closure still run after a dispatch failure.
Rerunning automerge for the merged PR identifies exact-SHA workflow runs and dispatches only missing checks.
The active agent-job cap is eight, the hard configurable ceiling is fifteen, and each lane has its own lower cap.
`.agent/config.json` is the machine-readable source for gate names, lane-specific model settings, backend selection, and capacity; `.agent/agent-policy.md` owns risk and approval meaning.

## Commands

Mutating automation CLIs support `--dry-run`; structured workflow calls use `--json`. `agent-router.mjs` is read-only and can route a saved event without GitHub mutation.

    node scripts/agent-labels.mjs --dry-run --json
    node scripts/agent-router.mjs --event-file event.json --json
    node scripts/agent-worker.mjs --validate-backend --lane implement --json
    node scripts/agent-concurrency-slot.mjs --lane implement --key 42 --json

Inspect and reconcile post-merge checks for a merged PR:

    REPO=sandeepsalwan1/Vet
    PR=123 # merged PR number
    MERGE_SHA="$(gh api "repos/$REPO/pulls/$PR" --jq .merge_commit_sha)"
    gh run list --repo "$REPO" --workflow ci.yml --event workflow_dispatch --json displayTitle,url --jq ".[] | select(.displayTitle == \"CI $MERGE_SHA\")"
    gh run list --repo "$REPO" --workflow codeql.yml --event workflow_dispatch --json displayTitle,url --jq ".[] | select(.displayTitle == \"CodeQL $MERGE_SHA\")"
    gh workflow run agent-automerge.yml --repo "$REPO" --ref main -f pr-number="$PR"

The automerge recovery run revalidates the merged pull request identity, dispatches only missing exact-SHA checks, and retries label and issue cleanup.

GitHub comments use managed markers and temporary body files. Never interpolate untrusted issue text into a shell command.
