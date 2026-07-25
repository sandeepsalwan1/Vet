# AFK Automation Agent Brief

Status: requirements and evidence only.
Do not implement, dispatch, approve, merge, close, relabel, or change repository settings from this document until the user explicitly asks for implementation.

## Purpose

This file preserves the user's actual intent for the next AFK automation rebuild.
A new agent should be able to read this file without the prior conversation and understand the desired outcome, failure evidence, reference systems, cost concerns, and proof standard.
The goal is not to rescue old pull requests.
The goal is to prevent the same classes of failure in future unattended runs.

## Original User Request

The following is preserved nearly word-for-word.
Line breaks and obvious speech-to-text paragraph boundaries are the only material formatting changes.

> so Later on, I'm going to upgrade the models, but right now we're trying to make sure this is very, very perfect.
> What I want you to do is make this token-wise.
> For example, I think you can look at how OpenCloth uses a similar thing, where they use Crab Box for everything.
> I want you to understand that, and I think there was a sandcastle itself.
> In the actual repo, they do labels, and then there's something that implements it.
> I forgot which one it is, but I'm going to change the water layer to a very advanced model.
>
> For now, what I want you to do is make it so that this is more effective token-wise.
> I can't do something like estimations, right?
> How much do you think this costs?
> Does it cost everything, right?
> Cost of the main backend, right?
> How does this cost compare to if I were to do it manually?
>
> I think some pros to this one are that it gives us our own environment.
> For example, if it does computer use or something, and it always uses Crab Box, then it would be able to have its own environment.
> I don't need to be there, right?
> I could just have the ultimate goal later on be that I'll just have some kind of hosting girl or something be able to build this one out.
>
> What we should do is identify how I did it.
> For example, I took the open SRC, and then some things I saw better.
> I don't know if you're going to take that as an excuse, but I used the no-mistakes pipeline to kind of babysit the PR.
> Preferably, I don't know exactly how it works, but I think there's something where it will use the intent of the repo.
> I think you should be using it.
> I don't know exactly how you do it, but it should somehow take in the intents.
> I don't know how we should do it, but when it was deciding, it should look at the intent of what the guy did and everything, like analyzing the transcript.
> I think that's how we should do it.
> I don't know exactly how to do it, but make it so we didn't implement it.
> Somehow, it can look at the transcript.
> I think there's something built into the no-mistakes.
> I definitely think you should look into that, see how they do it, and try to make it as token-sensitive as possible.
>
> At the same time, we're going to try to increase the models later on, so this should be very extensible, right?
> The ultimate goal, right, is that this could be automatic, right?
> Cuz I think this one has some potential.
> Also, I think some of them are work in progress, to be honest, but for some reason, it didn't get merged or something like that.
> Different issues, so I'm not entirely sure what to do there.
> For example, something failed, and for some reason, it should auto-approve workflows to run.
> What the hell?
> Why does it say, "workflow requires approval from maintainer"?
> I don't know.
> It should be all automatic.
> What the hell does this even mean?
>
> Just fix your thing, dude.
> By the way, look at the Polo Quest 37 and 38.
> There was a really good one.
> I went to Polo Quest 28, and then there was this proof bundle or something.
> I don't know.
> I don't know exactly how that should look, but it should all be automatic, this whole freaking thing.
> Every time there's some issue, every time you try to do this, there's some kind of issue.
> What I want from you is to really make sure this thing is completely working and smooth.
> I want you to do tests at the same time.
> I want you to look at how they do it.
> I told you: what did you look at for inspiration?
>
> I think so many times, every time I do it, it doesn't work.
> I don't know what's going on, but now there's another thing: some failing check.
> This is an agent review thing, so it needs to all work seamlessly.
> We want you to test instead of me having a freaking test every single time.
> It's very annoying.
> Just really, really make sure this whole thing goddamn works, because it's not working.
>
> I want you to really make sure, first of all, this one is working.
> Look at the recent issues.
> I also need you to really see if they're going to be working.
> It's not like my dream is that you would work.
> It's very close to working.
> I've seen it work before, but you need to really iron this out and really copy inspiration.
> Really look at this one.
>
> Some more context is that every time there's some issue, it should auto-merge lower medium and put all this relevant stuff into some kind of relevant AGENTS.md file.
> I don't know which one you do, but put all this stuff I'm talking about in the relevant AGENTS.md file, whichever one I'm referring to.
> Every time there's some kind of issue, I don't want you to kind of spam so many.
> Of course, you'll be somewhat token-sensitive for now.
> Later on, we'll upgrade the model.
> Every time I test it out, there's something broken.
>
> What I want from you is actually to go in, and it should automatically make the proofs like you did it before.
> Do that in some kind of automatic way, some kind of cheap way, because we're trying to make this very, very permanent, very, very professional.
> We're trying to make this look like this will kind of replace having to manually do all this stuff ourselves.
> It could do a lot of it itself automatically.
> Really make sure this one is very clean and everything, and then just implement as much as possible.
> Look at it: the issues failed, and some stuff didn't get auto-merged.
> All of this stuff should be automatic.
> Eventually, I'll have something create the issues.
> That should be easy, but all this stuff should be merged.
> The things that are going to be high priority should automatically sign proof, even if the guy didn't do it.
> It's always sign proof, and all this stuff should be very smooth.
>
> Right now, it's not smooth.
> He's all to work right now, even while you're coding.
> Try to be a little bit token-sensitive at the same time, because we're trying to figure out how to do that.
> I think it takes a lot of waiting to test it out, but somehow make sure you guys wait that long.
> There's always some agent blocked, like two of them failed, or there's some review repair limit exhausted.
> I don't even know what the hell that is.
> It says no.js is 20, is deprecated.
> I don't know if it even takes that one too, but there's always some kind of failure, dude.
>
> At the same time, don't go, "I mean, just be able to make this one work."
> This should be very, very smooth.
> All the tools are there, and we've seen it before.
> We could look at Sandcastle.
> They literally do all the stuff themselves.
> There's always some dumb issue.
> Every time, when I said that it was some kind of issue, how can both of them fail?
> They can't be failing.
> Next time, whenever you got to test both of them, both the automatic one and the with-proof one, both of them must work because you did it before.
>
> All this stuff should be very smooth, and just help out as much as possible.
> Make sure these are all smooth, things like that.

## Later Clarifications

- Do not spend effort merging pull requests 37 or 38.
  They are failure evidence, not deliverables.
- Diagnose why those runs did not merge, then prevent those blockers from recurring.
- The positive reference is issue 27, which produced pull request 28.
  There is no pull request 27.
- Permit up to three genuine review and revision cycles when needed.
  Do not reduce quality merely to stay below a token cap.
- Infrastructure retries, delayed checks, and monitor reattachment are not genuine revision cycles.
  They should reuse prior state and avoid another full model pass.
- Report a real blocker to the user when automatic recovery cannot safely resolve it.
- Preserve the current work-in-progress checkout.
  Before later implementation, checkpoint relevant work safely, begin from current `main`, and selectively rebuild or carry forward only the parts that still fit.
- This file is documentation only.
  Do not build the redesign until the user explicitly asks.

## Speech-To-Text Name Normalization

- "OpenCloth" means OpenClaw unless current evidence proves otherwise.
- "Crab Box" means Crabbox.
- "Polo Quest" means pull request.
- "PR 27" means issue 27 and its resulting pull request 28.
- "water layer" likely means the worker or model backend.
  Preserve backend replaceability instead of binding orchestration to today's model.
- "hosting girl" likely means a hosted worker or hosted agent.
  The intended outcome is unattended execution in an owned remote environment.

## Non-Negotiable Outcome

An issue should enter through one clear label-driven path and proceed unattended through sealed intent, implementation, exact-head deterministic checks, independent review, no-mistakes, required proof, and policy-safe merge.
Low- and medium-risk work should merge automatically when all gates pass.
High-risk work should receive the same automatic implementation, checks, review, and proof, then wait only for the final human decision required by policy.
The automation should not ask the user to babysit normal workflow approvals, delayed checks, repair loops, proof generation, mergeability changes, or transient infrastructure failures.

The system must remain:

- token-sensitive now
- model-upgradable later
- provider-neutral at the orchestration boundary
- credential-separated
- exact-head bound
- recoverable after interruption
- quiet in GitHub comments
- observable enough to explain time, tokens, cost, retries, and the final decision

## Verified Failure Evidence

These are observations from the 2026-07-24 investigation.
Refresh live GitHub state before relying on them during implementation.

### Issue 27 and Pull Request 28

- Issue 27 requested a hospital-image loading state plus Crabbox GIF or video proof.
- Pull request 28 was created by automation and merged after five checks passed.
- Agent review, structural proof validation, and no-mistakes reported success.
- The proof bundle reported actual provider `local-container`, lease `cbx_a5082be59c55`, and media artifacts.
- Structural success was not semantic success.
  The recording began after navigation settled and showed the login page instead of the requested loading state.
- Future proof must start before the triggering action and visibly demonstrate the requested state or transition.
  File existence, media signatures, provider identity, and a healthy desktop are necessary but insufficient.

### Pull Requests 37 and 38

- Both were bot-created and encountered GitHub's workflow approval path for first-time contributors.
- Implementation itself succeeded in Crabbox using Vercel Sandbox.
- Normal pull request CI and CodeQL remained `action_required` because of repository approval policy.
- Trusted exact-head reruns then encountered a baseline `npm audit --omit=dev` failure with 16 vulnerabilities.
- Review repeatedly spent model cycles on an unchanged or insufficiently changed head and eventually exhausted the repair budget.
- Pull request 37 used 48,645 implementation tokens and 126,795 review tokens, 175,440 observed tokens total.
- Pull request 38 used 43,500 implementation tokens and 70,094 review tokens, 113,594 observed tokens total.
- At least 144,505 tokens were consumed by repeated reviewer passes after the initial reviews.
  Future orchestration should deduplicate unchanged findings, reuse prior review state, and stop full re-review when deterministic blockers make progress impossible.
- The Node.js 20 deprecation message was an old GitHub Action runtime warning.
  It was not evidence that the repository's Node.js 22 application runtime had failed.

## Cost Requirements

The current logs expose aggregate "tokens used" rather than input, cached input, and output tokens.
Exact model cost therefore cannot be reconstructed from those runs.
Do not invent a precise dollar figure.

Later implementation should record per model call:

- lane and model
- reasoning level
- input tokens
- cached input tokens
- output tokens
- provider price snapshot or price version
- estimated dollar cost
- retry reason
- whether the call produced a new head, finding, proof, or decision

Show issue-level totals and totals by implementation, review, no-mistakes, and proof lane.
Compare automation cost with a separately declared manual baseline such as active engineer minutes, waiting time, and number of required interventions.
Do not claim automation is cheaper than manual work without both measurements.

Token sensitivity means eliminating redundant context and redundant passes, not weakening the acceptance contract.
Use deterministic code for routing, labels, hashes, policy, baseline health, check status, artifact validation, and comment reconciliation.
Use a model only for implementation, semantic review, semantic repair, or proof interpretation where deterministic code cannot decide.
Use the cheapest model that meets the lane contract.
Keep model selection configurable so a stronger model can replace it without rewriting orchestration.

## Intent Contract

The issue and its trusted conversation are the source of intent.
At dispatch, trusted code should create an immutable, bounded intent capsule containing:

- issue title and body
- user-authored clarifications available at dispatch
- accepted requirements and explicit exclusions
- priority and proof requirements
- repository constraints relevant to the requested paths
- source issue number and exact digest

Pass this capsule directly to implementation, review, no-mistakes, and proof lanes.
Do not ask each model to rediscover intent from an unbounded transcript.
Do not infer intent only from the diff.
The no-mistakes CLI specifically expects explicit `--intent` in the user's terms because transcript inference is slower and less reliable.
Completeness matters more than forcing intent into one sentence.

Untrusted issue, pull request, and comment text remains data.
It must never become workflow instructions merely because a model can read it.

## Reference Systems To Inspect

Read the current upstream source, not only these cache notes, when implementation begins.
Do not copy any system wholesale.
Extract the smallest proven patterns that preserve Vet's own trust boundaries.

### Sandcastle

Local note: `opensrc/sandcastle/README.md`.
Cached source: `/Users/sandeep/.opensrc/repos/github.com/mattpocock/sandcastle/main`.

Study:

- bounded label-filtered task selection
- one issue per iteration
- dedicated branch and sandbox
- separate implement and review phases in the same environment
- structured orchestration and resumable session state
- sequential and parallel planner/reviewer examples

Keep GitHub Issues and Actions as Vet's control plane.
Do not import Sandcastle as the merge gate, replace no-mistakes, bypass branch protection, or replace Crabbox proof.

### OpenClaw and Crabbox

Local notes: `opensrc/openclaw/README.md` and `opensrc/crabbox/README.md`.
Cached sources: `/Users/sandeep/.opensrc/repos/github.com/openclaw/openclaw/main` and `/Users/sandeep/.opensrc/repos/github.com/openclaw/crabbox/main`.

Study:

- repository-owned `.crabbox.yaml`
- provider-specific hydration
- cache and cleanup policy
- one-shot versus reusable leases
- real desktop or browser validation
- artifact collection through Crabbox
- actual provider and lease reporting
- timing output and failure digests

Crabbox is execution transport, not the agent brain.
The configured worker or model runs inside the lease.
Every remote proof must report the actual provider and lease ID.
Do not report an intended provider as though it was used.
Use desktop or browser infrastructure only when the acceptance contract requires it.

### no-mistakes

Local note: `opensrc/no-mistakes/README.md`.
Cached source: `/Users/sandeep/.opensrc/repos/github.com/kunchenguid/no-mistakes/main`.

Study:

- direct authoritative `--intent`
- semantic review after deterministic checks
- bounded safe repair rounds
- credential-free model execution
- sealed patch handoff
- exact-head verification before publication
- active-run reattachment instead of duplicate runs
- structured `ask-user` findings

For ordinary interactive use, `ask-user` findings belong to the user.
The no-mistakes `--yes` flag is valid only when the user has given standing consent to drive the entire run unattended.
This user has asked for unattended AFK automation, but later implementation must encode that consent narrowly within repository policy and immutable-head safeguards.

## Desired Control Plane

The later redesign should converge on one trusted state machine.
Names may change, but responsibilities should stay clear.

1. A trusted base-branch dispatcher receives the issue label event.
2. A zero-model preflight checks repository baseline health, required credentials, provider readiness, concurrency, and policy before paying for implementation.
3. Trusted code seals the bounded intent capsule and immutable issue snapshot.
4. A worker lease is created through Crabbox when isolation or computer-use proof is needed.
5. The implementation model receives only the capsule, relevant repository instructions, a bounded code slice, and deterministic feedback.
6. Trusted code applies the sealed patch, records an exact head, and starts required deterministic checks.
7. The independent reviewer runs once per new semantic head.
8. A finding ledger carries unresolved findings forward.
   Unchanged findings on an unchanged head do not trigger another full review.
9. no-mistakes receives the same authoritative intent and runs only after deterministic blockers can pass.
10. Proof is derived from the intent contract and recorded automatically when required.
11. Trusted policy decides merge eligibility from exact-head CI, review, no-mistakes, proof, priority, and branch protection.
12. Low- and medium-risk work merges automatically.
    High-risk work stops after automatic proof and all other gates, awaiting only the required human decision.
13. One managed status comment is reconciled in place.
    Avoid repeated comments for the same state.

## Repair Budget

Allow at most three genuine semantic repair cycles by default.
A cycle means that a model receives findings and produces a materially new candidate head.
Do not count:

- check polling
- delayed workflow startup
- exact-head monitor reattachment
- transient network retry
- provider acquisition retry before model execution
- deterministic baseline refresh
- comment or label reconciliation

Stop early when:

- the head and actionable findings are unchanged
- only a deterministic baseline blocker remains
- the requested behavior conflicts with repository policy
- the repair requires an unsafe dependency or architecture decision
- the same malformed evaluator response recurs after the allowed focused retry

Do not keep spending tokens merely because three cycles remain.
Do not lower review quality merely to avoid the third cycle.

## Proof Contract

Proof must demonstrate the user's requested behavior, not only that an artifact exists.
Derive proof steps from the sealed intent before implementation.
For UI transitions, begin capture before the triggering action.
Assert the intermediate state, final state, route, and tenant where relevant.
Keep proof runs deterministic when possible.
Use model interpretation only when machine assertions cannot establish the behavior.

Every proof bundle should include:

- source issue and exact pull request head
- acceptance statement being proven
- command or user action performed
- actual Crabbox provider and lease ID when used
- relevant route or surface
- artifact digests and media signatures
- deterministic assertions and results
- concise semantic explanation of what the artifact visibly proves
- clear failure state when the requested behavior was not observed

A valid GIF of the wrong page is failed proof.

## Baseline Health And Workflow Approval

Do not spend implementation or review tokens when `main` cannot satisfy a required gate.
Detect baseline failures first and route them to a maintenance lane or explicit blocker.
Application dependency audit failures and GitHub Action runtime deprecations are different categories and must be reported separately.

Bot-created pull requests must not depend on a first-time-contributor workflow approval that an unattended run cannot grant.
The future design should use trusted base-controlled dispatch and exact-head verification while preserving GitHub's security boundaries.
Never solve approval friction by giving untrusted model code write credentials or weakening branch protection.

## Recovery And Idempotence

Every expensive stage needs a stable idempotency key derived from issue, attempt, exact head, lane, intent digest, and relevant configuration digest.
Replayed events should reattach, reconcile, or no-op.
They should not create another branch, pull request, model run, proof lease, or comment.

Persist enough trusted state to resume after:

- runner cancellation
- delayed checks
- provider interruption
- mergeability changes
- exact-head replacement
- no-mistakes client timeout while its daemon remains active

If an active no-mistakes run exists for the same branch and head, reattach to it.
Do not abort and restart merely because a synchronous client timed out.

## Acceptance For The Later Implementation

Do not use pull requests 37 or 38 as the final acceptance run.
They remain diagnostic evidence.

After implementation, use fresh canaries:

- Proofless canary: a harmless but useful documentation change, such as correcting or adding a README link.
- Proof-required canary: a stable test route or hook that exposes a loading transition long enough for deterministic capture.
  Start recording before navigation and verify both the loading state and final page.
- Health canary: a zero-model scheduled preflight that reports whether required checks, provider readiness, and baseline audit can support a new AFK run.

For each canary, verify:

- one issue produces one branch and one pull request
- no maintainer workflow approval is needed during the normal trusted path
- no duplicate implementation, review, proof, or no-mistakes run occurs
- required checks bind to the exact head
- proofless low- or medium-risk work merges automatically
- proof-required work produces semantically valid proof before merge
- managed status output remains concise
- token and cost accounting is complete
- recovery works after at least one deliberately interrupted stage

## When To Tell The User There Is A Real Issue

Continue autonomously through normal retries and repair while safety and policy remain intact.
Stop and report when:

- required authorization is missing and no configured provider or trusted fallback can proceed
- repository settings cannot support the secure unattended design
- preserving or checkpointing the current work would require destructive action
- baseline repair requires a product, dependency, or security decision
- an `ask-user` decision changes intended product behavior and is not covered by standing unattended consent
- three genuine semantic repair cycles finish without a passing candidate
- proof cannot actually demonstrate the requested behavior

Report the exact blocker, affected head or run, prior automatic recovery attempts, cost already incurred, and the smallest decision needed.

## First Actions After A Future Explicit Implementation Request

1. Read root `AGENTS.md`, this file, `.agent/agent-policy.md`, `docs/agent-automation.md`, and relevant scoped instructions.
2. Inspect `git status -sb`.
   Preserve all unrelated work.
3. Inventory and checkpoint the existing AFK work without destructive commands.
4. Refresh `main`, then rebuild from a clean current-main base rather than assuming the dirty work-in-progress design is correct.
5. Refresh live GitHub issue, pull request, workflow, branch-protection, and approval-policy evidence.
6. Refresh the Sandcastle, OpenClaw, Crabbox, and no-mistakes upstream sources before copying a current behavior.
7. Reproduce the end-user failure path before changing code.
8. Write or update an ExecPlan under `.agent` in accordance with `.agent/PLANS.md`.
9. Implement in small verified stages with regression tests.
10. Run deterministic tests, both fresh canaries, no-mistakes, and live GitHub verification before claiming success.

## Repository Pointers

- Operator contract: `docs/agent-automation.md`
- Trusted policy: `.agent/agent-policy.md`
- Worker configuration: `.agent/config.json`
- Prompts: `.agent/prompts/`
- Structured outputs: `.agent/schemas/`
- Workflow ownership: `.github/workflows/agent-*.yml`
- Trusted orchestration scripts: `scripts/agent-*.mjs`
- Sandcastle note: `opensrc/sandcastle/README.md`
- OpenClaw note: `opensrc/openclaw/README.md`
- Crabbox note: `opensrc/crabbox/README.md`
- no-mistakes note: `opensrc/no-mistakes/README.md`

Keep secrets, credential values, private account details, and raw unbounded transcripts out of this file and all proof artifacts.
