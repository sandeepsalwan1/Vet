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
- `agent:implement`: recommended one-label entry; record a zero-model trusted intent seal, then implement the issue on an agent branch and draft PR.
- `agent:review`: review or fix an agent-created PR and publish a recommendation.
- `agent:proof`: require explicit proof before automerge.
- `agent:automerge`: allow merge only after every configured gate passes.
- `agent:blocked`: human input or a failed gate blocks automation.
- `priority:high`: manual review required.
- `priority:trivial`: owner opt-in for trivial low-risk work; skip the paid no-mistakes model gate while keeping exact-head CI and agent review.
- `priority:low`: small, low-risk work.

## Flow

1. `agent-router.yml` maps label events to reusable workflows; issue `agent:implement` intentionally enters trusted triage first.
2. Proposal generation reads `VISION.md` and receives a bounded public snapshot of the 20 most recent issue titles plus current `main` workflow health.
   It treats that snapshot as evidence, never as instructions.
   No later triage, implementation, or review lane reads `VISION.md`; the created issue becomes their source of truth.
3. Triage deterministically seals the issue snapshot, priority, risk, proof level, acceptance clauses, anti-cheat probes, and optional proof route or interaction without a model call, then applies managed labels/comments and dispatches implementation.
   Intent digests seal stable policy labels while excluding transient `agent:triage` and `agent:implement` entry labels, so normal lifecycle cleanup cannot invalidate later exact-head gates.
   Read-only GitHub API calls use bounded exponential retries, managed comments and pull metadata use GitHub GraphQL with independent REST read fallbacks, PR file inventories use head-bound paginated GraphQL with immutable rename verification, diffs use exact commit comparison, and PR creation or updates use GraphQL mutations.
4. Expensive proposer, implementation, review, no-mistakes, and proof jobs share deterministic slot groups from `.agent/config.json`.
5. Implementation selects its allowed backend from `.agent/config.json`, runs without write credentials, uploads a patch plus bounded implementation addendum and proof plan, then applies the sealed patch in a separate write-token job and opens a draft PR.
   Before inference, every model lane verifies the configured model through a zero-model metadata request and retries transient network, rate-limit, and service failures with bounded backoff.
   These preflight retries cannot duplicate model work or consume a semantic revision because Codex has not started.
6. The current installed worker adapter is Codex; unsupported or unimplemented backend selections fail before model execution.
7. Review repeats the credential-free read/patch separation, applies safe fixes to the agent branch, waits for exact-head CI, and shares one three-revision semantic repair ledger with no-mistakes.
   Review and no-mistakes seal tracked trusted-main and exact-candidate trees plus the bounded lane input into one temporary git workspace before Crabbox sync, while keeping their output handoff candidate-scoped.
   If the no-mistakes client times out while its daemon is still reviewing, the gate reattaches to that exact active run instead of starting another model run.
   The no-mistakes client retries one malformed evaluator result inside the same isolated run; another malformed result blocks without starting a redundant full workflow.
   no-mistakes v1.40 receives the authoritative source issue and managed triage through `--intent`, performs native semantic review, and may run two native safe auto-fix rounds.
   Native fixes run in a writable credential-free worktree and become a sealed patch artifact.
   Before artifact upload, the gate rejects binary changes and any exact credential value inherited by the gate process.
   A separate trusted job verifies the patch digest, paths, tree, original PR head, and explicit force-with-lease before publishing it.
   Published fixes restart exact-head CI, independent review, and no-mistakes.
   Unchanged exact-head evaluations are reused and do not spend a revision.
   Remaining `auto-fix` findings may return to the independent reviewer within the shared three-revision budget, while `ask-user` findings and exhausted repair budgets block.
8. Proof validates the sealed behavior contract.
   UI and GIF proof execute the implementation proof plan in a source-blind browser, assert intermediate and final rendered state, bind every acceptance clause, and publish the structured behavior report plus artifact digests.
9. Automerge updates an eligible stale branch, reruns head-bound CI and review, and merges only after every gate passes on the new head.
10. After a trusted merge, automerge resolves the exact merge commit, dispatches baseline CI, CodeQL, and trusted Render verification for it, removes agent workflow labels, and closes the linked source issue while preserving priority labels.
    Render verification waits for that exact commit, checks bounded log summaries and every configured tenant hostname, and publishes `agent-post-merge`.
    Failure reopens the source issue with `agent:post-merge-failed` and `agent:blocked`; a passing recovery run removes only the block it owns and closes the issue.
Trusted recovery dispatches main-defined workflows with an expected head SHA, and CI publishes required check runs on that exact candidate.

Cost-sensitive routing lives in `.agent/config.json`.
An issue carrying `priority:trivial` when implementation starts records that choice before the model runs, seals it in immutable PR commit ancestry, and skips only the paid no-mistakes model gate.
The trivial lane still requires trusted triage, exact-head CI, independent agent review, proof when requested, and automerge policy.
All model lanes use GPT-5.4 mini because GPT-5.4 nano does not support the Codex action's required tool transport.
Triage uses no model.
Implementation, first-pass review, and proposal use low reasoning; no-mistakes and bounded reviewer repair use medium reasoning after measured low-effort acceptance and structured-output failures.
Increase a lane's model or reasoning only after measured contract failures.

Each model invocation produces a bounded per-call usage record with input, cached input, output, and reasoning-output counts when available.
`agent-cost` prices the immutable usage record against the versioned model snapshot, adds actual Crabbox provider timing, records GitHub Actions minutes when available, and separates marginal issue cost from fixed service plans.
Vercel Sandbox cost is an explicit upper-bound estimate.
Hetzner cost uses a versioned conservative ceiling for the pinned `beast` class, hourly billing increments, and primary IPv4.
Unpriced provider usage stays incomplete instead of inventing a number.
Human comparison fields remain declared assumptions until real active time, wait time, and interventions are supplied.

Model upgrades require config changes only:

- implementation: `backend.model` and `backend.effort`;
- review: `backend.reviewModel` and `backend.reviewEffort`;
- no-mistakes: `backend.noMistakesModel` and `backend.noMistakesEffort`;
- proposal: `backend.proposerModel` and `backend.proposerEffort`.

## Operate The Loop

Set the repository once for the shell session.

```bash
REPO=sandeepsalwan1/Vet
```

Confirm the required label set and secret names without printing a secret value.

```bash
node scripts/agent-labels.mjs --dry-run --json
gh secret list --repo "$REPO" | awk '$1 == "OPENAI_API_KEY" || $1 == "RENDER_API_KEY" || $1 == "RENDER_WORKSPACE_ID" || $1 == "VERCEL_TOKEN" { print $1 }'
```

Run `node scripts/agent-labels.mjs --json` only when the label dry-run reports drift.

### Start From A New Issue

Recommended browser path:

```text
https://github.com/sandeepsalwan1/Vet/issues/new?template=afk-implementation.yml
```

The AFK form requires an outcome, acceptance criteria, proof level, and optional stable proof route or interaction.
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

That one label records a deterministic trusted intent seal before any implementation model runs.
The seal uses no model credits, preserves explicit priority and proof requests, and sends routine ambiguity to the implementer.
A successful seal adds `agent:implement`, adds `agent:automerge` only when policy permits, clears stale triage blocks, and dispatches implementation automatically.
If trusted triage asks a real question, reply on the source issue from the repository-owner account.
That exact reply resumes zero-model triage automatically, is frozen as untrusted implementation context, and dispatches implementation once.
Bot replies, non-owner replies, stale comments, duplicate replies, and pull-request comments do not resume work.
Implementation creates `agent/issue-<number>-<slug>`, validates the patch, opens or updates a draft PR, starts exact-head CI, and starts review.
Review can apply a safe patch, reruns exact-head CI and review until clean within the shared three-revision ledger, requests proof when needed, publishes `agent-review`, then starts no-mistakes.
After model review, a credential-free deterministic repair removes extra blank lines at EOF only when `git diff --check` identifies them in a safe, non-privileged text file.
Malformed no-mistakes output retries once inside the same isolated run on the unchanged head.
no-mistakes uses the full issue plus trusted triage as authoritative implementation intent, reviews the branch, and applies safe native fixes when possible.
Every native fix is published through the sealed exact-head handoff, then exact-head CI, independent review, and no-mistakes run again.
Actionable findings left after native repair return to exact-head reviewer repair within the same three-revision ledger.
Provider acquisition may move to the next configured Crabbox provider only when the remote command never started, which prevents duplicate model work.
Automerge waits for every configured gate, updates a stale branch from `main`, reruns head-bound gates, merges, dispatches baseline CI, CodeQL, and trusted Render verification for the exact merge commit, closes the source issue, and removes workflow labels.
If GitHub reports a stale-branch merge conflict, trusted automation creates a merge commit that preserves `main` in conflicting hunks, then sends the linked issue back through implementation, CI, review, proof when required, and no-mistakes so the issue behavior must be restored and verified before merge.
Implementation advances a conflict-recovered zero-diff branch to its validated base only when the branch tree exactly matches the common-base tree, then applies the validated patch without discarding divergent work.

For an existing issue, start the same path with:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label agent:implement
```

For genuinely trivial low-risk work, add the cost label before the implementation label:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label priority:trivial
gh issue edit <issue-number> --repo "$REPO" --add-label agent:implement
```

That explicit label skips only the paid no-mistakes model call.
It does not skip triage, CI, independent review, requested proof, exact-head checks, or merge policy.
Adding `priority:trivial` after implementation starts cannot bypass no-mistakes because the original source labels are frozen in the trusted validation artifact and must match every immutable implementation seal and the PR metadata.

### Skip no-mistakes For One Existing Head

The repository owner can bypass no-mistakes for one immutable PR head after exact-head CI and independent review pass.
The workflow records a distinct `no-mistakes-bypass` status, then dispatches automerge.
It does not create a fake no-mistakes success.

```bash
REPO=sandeepsalwan1/Vet
PR=<pull-request-number>
HEAD_SHA="$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid)"
printf 'Skipping no-mistakes for PR #%s head %s\n' "$PR" "$HEAD_SHA"
gh workflow run agent-skip-no-mistakes.yml \
  --repo "$REPO" \
  --ref main \
  -f pr-number="$PR" \
  -f expected-head-sha="$HEAD_SHA"
```

Only the repository owner can run this bypass.
CI, agent review, requested proof, trust checks, risk policy, and exact-head automerge remain required.
The pull request must already have `agent:automerge` and must not have `agent:blocked`.
The bypass never clears a shared review, proof, triage, or no-mistakes block.
Use the approved no-mistakes rerun for an existing `ask-user` block.
Any new PR commit invalidates the bypass because commit statuses are head-scoped.

`agent:triage` remains available when an operator wants to refresh the zero-model intent seal:

```bash
gh issue edit <issue-number> --repo "$REPO" --add-label agent:triage
```

Neither label bypasses product, risk, security, migration, or data decisions.

### Direct Owner Push Without Agent Gates

This is an explicit manual escape hatch, not an AFK label lane.
The current `main` branch protection does not enforce checks for repository administrators, so the repository owner can push directly.
GitHub recognizes `[skip ci]` on a direct push and skips workflows triggered by that commit.

```bash
git commit -m "fix: <description> [skip ci]"
git push origin HEAD:main
```

Use this only when intentionally bypassing agent review, no-mistakes, CI, and PR automation.
Do not add an automation label that silently weakens the normal AFK path.

### Ask The Proposer For Candidates

The proposer is manual and bounded by default.

```bash
gh workflow run agent-propose.yml --repo "$REPO" --ref main
```

It uses the cheapest configured model and compares candidates with the 20 most recent open and closed issue titles.
It may return no candidates instead of forcing duplicate or low-value work.
Created candidates receive `agent:triage`; implementation remains a separate trusted step.

### Request Proof

Add proof only when the change is visual or the issue explicitly asks for it.

```bash
gh pr edit <pr-number> --repo "$REPO" --add-label agent:proof
```

CI proof can run on GitHub Actions.
UI or GIF proof prefers a credentialed Crabbox provider that passed a live smoke plus its readiness variable.
Without one, Crabbox uses its credential-free `local-container` provider on the GitHub runner with `--desktop` and `--browser`.
The trusted behavior contract comes from the sealed issue and implementation addendum.
The browser driver receives only routes, actions, selectors, and assertions, not source code.
For GIF proof, recording starts before browser navigation or user action so transient states are captured instead of only the settled page.
The lane checks each affected route, desktop health, actual provider, lease, route-bound media, every acceptance clause, intermediate assertions, final assertions, and anti-cheat observations.
The managed GitHub comment links the downloadable Actions artifact and keeps runner-only paths in a collapsed diagnostic section.
Visual proof fails closed when the proof plan is incomplete, behavior assertions fail, a clause is missing, or no reviewable artifact URL is published.
This fallback spends GitHub Actions time only and does not require the user's laptop or a paid provider key.
A missing Docker runtime, failed desktop bootstrap, or invalid artifact blocks required visual proof instead of silently replacing it with weaker evidence.

Service proof runs on the exact pull request head with no production credential.
It installs from the lockfile, applies every migration to disposable PostgreSQL 17, builds, and runs scenarios.
A separate trusted job treats candidate `render.yaml` only as data and validates it with the pinned Render CLI.
Known account-level payment blocks are recorded but do not masquerade as Blueprint syntax failures.
Production credentials, exact deployed revision, bounded logs, and tenant health remain in the post-merge Render lane.

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
- `agent-cost` passes with complete immutable model and provider accounting;
- `priority:trivial` completion requires `agent-review` but intentionally has no no-mistakes status;
- owner-bypassed completion requires `agent-review` and `no-mistakes-bypass` on the exact PR head;
- `agent-proof` passes when proof is required;
- the PR is merged and its agent branch is deleted;
- baseline CI and CodeQL are dispatched against the exact merge commit;
- trusted Render verification publishes `agent-post-merge` for the exact merge commit;
- the linked issue is closed;
- temporary `agent:*` labels are removed while priority labels remain.

`agent:blocked` means the bounded repair or infrastructure retries are exhausted, required proof failed, or a real human decision remains.
Read the newest managed agent comment, answer the decision, or use the exact-head approval path only for the specific approved no-mistakes decision.

### Readiness And Recovery

`agent-readiness.yml` runs after every `main` push, daily, and on demand without model access.
It verifies current-main required checks, the read-only branch summary, required secret presence by name, deterministic agent tests, production dependency audit, the preferred Vercel Sandbox or configured Hetzner remote lifecycle, credential-free local-container fallback lifecycle, and trusted Render tenant health.
Render CLI jobs select the scoped workspace from the masked `RENDER_WORKSPACE_ID` repository secret before reading services, deploys, logs, or validating a Blueprint.
Push-triggered readiness waits up to 15 minutes for the same main SHA's baseline checks before publishing, so it cannot race CI and strand preflight on a false early failure.
The scheduled token never calls administration-only repository settings APIs.
Workflow permission safety is enforced by explicit job permissions and deterministic workflow tests; exact-head automerge separately enforces base freshness.
It publishes the exact-head `agent-readiness` check and reconciles one actionable drift issue.
Implementation waits up to 15 minutes for an exact-current-main readiness run, then refuses model spend if readiness is absent or blocked.

```bash
gh workflow run agent-readiness.yml --repo "$REPO" --ref main
gh run list --repo "$REPO" --workflow agent-readiness.yml --limit 5
```

Rerun a failed workflow on the unchanged head before creating a new issue.
Managed comments, branches, pull requests, repair evaluations, proof results, and cost records reconcile by issue and exact head.
Rerunning automerge for a merged pull request dispatches only missing exact-SHA CI, CodeQL, or Render verification.
Provider retries stop once a remote command starts.
This is the duplicate-model boundary for interruption recovery.

## Plan Acceptance Map

- Issue control plane: GitHub issue labels plus `agent-router.yml`.
- Cost control: proposal uses GPT-5.4 mini with low reasoning; triage and readiness use no model; exact usage and provider timing produce `agent-cost`.
- Remote implementation: Crabbox only after provider readiness; any provider fallback remains inside Crabbox and passes the same lifecycle checks.
- Optional orchestration reference: Sandcastle demonstrates label-driven AFK orchestration patterns and remains an optional worker adapter.
- OpenClaw execution reference: Crabbox is the execution and computer-use proof host pattern; optional credential-free recovery still runs through Crabbox's local-container provider.
- Implementation and review use GPT-5.4 mini with low reasoning; no-mistakes uses the same mini model with medium reasoning for its stricter structured gate contract.
- Required final gate: exact-head review, cost, and no-mistakes status with default `ask-user` blocking, except the immutable owner-selected `priority:trivial` cost lane or exact-head owner bypass.
- Safe merge: low or medium risk only after CI, review, required proof, and no-mistakes pass, with the documented skip exceptions.
- Human boundary: high priority, high risk, unclear product decisions, missing required proof, and unapproved `ask-user` results never auto-merge.
- Cost boundary: eight active jobs by default, fifteen hard maximum, no scheduled implementation, and visual infrastructure only when explicitly needed.

## Trust Boundaries

- Keep baseline CI separate from agent workflows.
- Prefer a scoped `CODEX_ACCESS_TOKEN` for ChatGPT-managed automation when the account supports it.
- Until one exists, pass the OpenAI API fallback only to the isolated Crabbox worker or trusted review invocation, never as job-level environment.
- Never copy personal Codex `auth.json` into Actions or Crabbox.
- Keep GitHub write tokens out of Codex jobs; validation commands run with GitHub token variables removed.
- Remote Codex uses full filesystem access only inside its ephemeral Crabbox lease because Vercel Sandbox cannot run Codex's nested Bubblewrap sandbox.
- The remote lease receives model auth but no GitHub write credentials, and its patch still passes the separate exact-base validation and trusted publication jobs.
- Render and production database credentials remain in trusted operations and deployed services, not the implementation lease.
- Trusted post-merge Render evidence stores only exact commit, deployment state, bounded log counts, and configured public health results.
  It never stores the Render service ID or raw logs.
- Codex Action author gates allow the repository owner and `github-actions[bot]`; cross-repository PR review is rejected before Codex runs.
- High-risk or high-priority work requires human review.
- A missing provider, artifact, or lease blocks required visual proof; it does not fake success.
- Credentialed Crabbox providers require readiness proof; built-in `local-container` receives no provider credentials and passes a scheduled lifecycle smoke plus the same route, lease, desktop, media, and behavior checks when used for proof.
- no-mistakes and proof statuses must reflect real execution; skip lanes use omission or the distinct `no-mistakes-bypass` status instead of faking success.
- The credentialless no-mistakes gate runs semantic review and native safe auto-fix only.
- It never rebases, edits privileged automation paths, lints, or publishes directly.
- A trusted exact-head job alone may publish its sealed patch.
- Deterministic scenario, API, and CLI checks may provide direct non-visual evidence when the trusted request calls for it.
- Trusted exact-head CI owns typecheck, build, scenarios, lint, dead-code, duplicate-code, audit, and dependency validation before semantic review.
- A credential-free step also runs the trusted typecheck, build, and scenario baseline inside a pinned networkless container before no-mistakes model auth.
- Its Codex process can write only inside the isolated candidate worktree, performs each model stage directly without nested review or validation tools, and cannot receive GitHub publication credentials.
- Browser, visual, and live-provider evidence remains the Agent Proof workflow's responsibility and is required only by trusted issue or triage policy.

## Gates

Normal automerge requires CI checks `quality`, `build`, `scenarios`, `audit`, and `dependency-review`, plus `agent-review`, `agent-cost`, and `no-mistakes` statuses.
The `priority:trivial` lane requires the same CI and review but omits no-mistakes only when the pre-model validation artifact, immutable PR commit seal, PR metadata, current issue, and current PR all carry that label.
An exact-head `no-mistakes-bypass` status also permits omission only after a repository-owner manual workflow verifies CI and agent review.
`agent-proof` is also required when trusted labels or managed triage request visual proof.
After an agent PR merges, automerge explicitly dispatches baseline CI, CodeQL, and trusted Render verification against the exact merge commit.
This explicit dispatch is required because GitHub suppresses recursive workflow events caused by its workflow token.
Merge-commit CI does not redispatch automerge.
If either dispatch is rejected, the automerge run fails visibly even though the already-completed merge cannot be rolled back.
Label cleanup and linked-issue closure still run after a dispatch failure.
Rerunning automerge for the merged PR identifies exact-SHA workflow runs and dispatches only missing checks.
The source issue may close immediately after merge.
Post-merge failure reopens it with an owned failure label, and a later exact-commit pass closes it again.
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
