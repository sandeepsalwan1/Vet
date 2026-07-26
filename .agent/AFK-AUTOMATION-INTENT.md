# AFK Automation Agent Brief

Strong recommendation: use this plan as the default implementation contract when building or changing AFK automation.
Modify it only when verified evidence shows an assumption is wrong or a safer, simpler, cheaper, or more reliable design better preserves the same outcome, and record the reason.

## Purpose

This file preserves the user's actual intent for the next AFK automation rebuild.
A fresh maintainer agent should be able to read this file without the prior conversation and understand the desired outcome, failure evidence, reference systems, cost concerns, and proof standard.
Routine issue workers must not receive this entire control-plane brief.
They receive the sealed issue intent, relevant repository instructions, and `vet-worker`, which preserves the same execution rules without the token cost or unrelated control-plane context.
The goal is not to rescue old pull requests.
The goal is to prevent the same classes of failure in future unattended runs.

## Cold-Start Directive

Continue the implementation from the current working tree.
Do not reset, clean, overwrite, or discard the existing AFK changes.
Do not stop after improving this document, passing local tests, or completing one provider smoke.
Keep working through repair and fresh production-path canaries until every readiness condition in this file passes or a real external blocker requires the smallest possible user action.

Treat this file as the outcome and acceptance contract.
Treat `docs/agent-automation.md` as the operator contract.
Treat current code and live service state as evidence, not assumptions.
When they disagree, verify the intended behavior, fix the implementation, and update the operator documentation.

Use deterministic checks before model calls.
Reuse exact-head state and run focused retries.
Do not weaken implementation quality, review quality, proof, or safety merely to reduce tokens.
Do not ask the user to perform routine debugging, polling, approvals, reruns, or recovery.

## Current Handoff Snapshot

This snapshot was refreshed on 2026-07-25 and must be reverified where state can drift.

- The checkout is on `main` and intentionally contains uncommitted AFK automation changes.
  Preserve them and inspect the complete diff before editing.
- The implementation uses Crabbox-only model lanes, a reviewed project skill bundle, structural skill discovery, and scoped credential handoffs.
- Intent capsule v4 seals acceptance clauses, per-clause evidence lanes, proof routes and interactions, anti-cheat probes, and a digest-bound behavior contract while remaining compatible with existing v1 through v3 issue seals.
- Review and no-mistakes share one three-revision semantic ledger.
  Replayed unchanged evaluations, infrastructure retries, malformed-output retries, and active-run reattachment do not spend a revision.
- Every model lane emits bounded per-call usage.
  Trusted cost accounting adds provider timing, versioned Vercel and conservative Hetzner price snapshots, GitHub Actions usage when available, fixed-service separation, and explicit human-comparison assumptions.
- UI and GIF proof execute a bounded source-blind browser plan, assert intermediate and final rendered behavior, cover every browser-assigned sealed clause, hash artifacts, and fail closed on semantic mismatch.
  Trusted finalization combines that browser evidence with required deterministic or service evidence for the remaining clauses.
- Trusted post-merge verification selects an exact deployed `main` revision that contains the merge, checks bounded logs and all configured public tenant hostnames, and reopens or recloses the source issue through one owned failure marker.
  When that revision is absent, it requests the latest configured `main` branch without pinning an old SHA, pins the returned deployment, and proves both merge ancestry and non-rollback ancestry before passing.
- Daily zero-model readiness now checks exact-main baseline, repository policy, credential presence, deterministic tests, dependency audit, the preferred Vercel or configured Hetzner remote lifecycle, the credential-free fallback lifecycle, and Render health before model spend.
  It also verifies the trusted publisher's owner identity, intended repository access, and reported push authorization without exposing the token.
  Push readiness waits for baseline checks on its exact main SHA before publishing.
- Provider acquisition retries may select the next configured provider only before the remote command starts.
- The full local automation suite, typecheck, lint, dead-code, and duplicate-code gates passed after these changes.
  Rerun them after final documentation and live-canary changes.
- A redacted zero-model Vercel Sandbox lifecycle and exact project-local skill discovery passed during bootstrap.
- Local Codex is signed in through ChatGPT.
  `CODEX_ACCESS_TOKEN` is not configured and its setup is deliberately deferred.
  The existing scoped API-key lane remains the non-interactive fallback and must not block the core reliability work.
- Fresh proofless, proof-required, recovery, and concurrency issue canaries have not passed through the production GitHub path yet.
- Subscription-token migration remains a deferred cost optimization.
- Fresh production-path canaries and closeout review remain acceptance work.

Do not claim completion from this snapshot.
It exists to prevent duplicated investigation and accidental loss of working progress.

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

- Pull requests 37 and 38 do not need to be recovered or merged.
  Preserve their diagnostic evidence, then close them if that makes the clean rebuild easier to understand.
- Diagnose why those runs did not merge, then prevent those blockers from recurring.
- The positive reference is issue 27, which produced pull request 28.
  There is no pull request 27.
- Permit up to three genuine review and revision cycles when needed.
  Do not reduce quality merely to stay below a token cap.
- Infrastructure retries, delayed checks, and monitor reattachment are not genuine revision cycles.
  They should reuse prior state and avoid another full model pass.
- Report a real blocker to the user when automatic recovery cannot safely resolve it.
- Preserve the current work-in-progress checkout.
  Checkpoint relevant work safely, begin from current `main`, and selectively rebuild or carry forward only the parts that still fit.
- Keep going through implementation, repair, live provider validation, and fresh end-to-end canaries until the system is proven ready for the user's next real issue.
- Remain token-sensitive while testing.
  Focused reruns and reused state are preferred.
- Keep one simple execution design.
  Crabbox is the worker environment and GitHub Issues plus Actions are the control plane.
- Do not create a second Hostinger implementation worker.
  Hostinger or any future service may create the GitHub issue, but the issue must enter the same `agent:implement` path.
- Give Crabbox the relevant project skills, browser capability, and isolated filesystem needed for the sealed task.
  Do not copy the entire personal skill catalog when a smaller reviewed project bundle covers the work.
- "A copy of me" means proactive execution, broad Vet capability, persistent recovery, and real verification.
  It does not mean copying personal browser profiles, unrestricted production credentials, or password-equivalent Codex files into generated environments.
- Full authentication means each trusted lane has the scoped access needed for its responsibility.
  Generated implementation code must never receive all credentials.
- ChatGPT subscription-backed Codex auth remains preferred when a supported automation token is available.
  Its setup is deferred and must not block proving the current API-backed pipeline.
- Keep the current model path token-efficient without materially reducing quality.
  Production-quality code, tests, review, and proof remain mandatory.

## Speech-To-Text Name Normalization

- "OpenCloth" means OpenClaw unless current evidence proves otherwise.
- "Crab Box" means Crabbox.
- "Polo Quest" means pull request.
- "PR 27" means issue 27 and its resulting pull request 28.
- "AutoIssue" means submitting the AFK implementation issue form or adding `agent:implement` to an existing issue.
- "water layer" likely means the worker or model backend.
  Preserve backend replaceability instead of binding orchestration to today's model.
- "hosting girl" likely means a hosted worker or hosted agent.
  The intended outcome is unattended execution in an owned remote environment.

## Non-Negotiable Outcome

An issue should enter through one clear label-driven path and proceed unattended through sealed intent, implementation, exact-head deterministic checks, independent review, no-mistakes, required proof, and policy-safe merge.
Low- and medium-risk work should merge automatically when all gates pass.
High-risk work should receive the same automatic implementation, checks, review, and proof, then wait only for the final human decision required by policy.
The automation should not ask the user to babysit normal workflow approvals, delayed checks, repair loops, proof generation, mergeability changes, or transient infrastructure failures.
Do not declare this system ready because unit tests pass or an old pull request can be recovered.
Declare it ready only after fresh proofless and proof-required issues complete through the real GitHub control plane.

"Works no matter what is thrown at it" means every supported issue reaches the correct terminal state without the automation itself breaking.
A valid request should implement, validate, and merge according to policy.
An unsafe, contradictory, impossible, or underspecified request should fail closed once, preserve its evidence, and ask one concise actionable question.
Unsupported work must not cause duplicate runs, endless repair, silent failure, or misleading success.

The system must remain:

- token-sensitive now
- model-upgradable later
- provider-neutral at the orchestration boundary
- credential-separated
- exact-head bound
- recoverable after interruption
- quiet in GitHub comments
- observable enough to explain time, tokens, cost, retries, and the final decision

## Vet Project Capability Contract

Any well-formed request that can be safely completed within the Vet repository or its configured GitHub, Crabbox, Render, Postgres, Supabase, browser-proof, and notification surfaces should reach the correct terminal state without routine user intervention.
The automation must not be narrowly tuned only to the canary examples or the failures in pull requests 37 and 38.
It must route new project work from intent and acceptance criteria.

Supported work includes:

- application code, packages, routes, APIs, tests, documentation, and configuration
- polished UI implementation and source-blind browser behavior verification
- tenant-safe Postgres or Supabase schema, query, migration, and integration work
- Render configuration, deployment, health, logs, and post-merge verification through trusted operations
- GitHub issue, branch, pull request, CI, review, proof, merge, and recovery operations
- notification and external-service integration work when the required scoped credentials and policy already exist
- deterministic CLI, API, scenario, security, dependency, and architecture maintenance

Route capability deliberately:

- General implementation uses `vet-worker` and repository instructions.
- UI work adds the Vet frontend and shadcn skills and requires browser proof when behavior is user-visible.
- Data work adds the relevant Postgres or Supabase skill and uses a disposable or explicitly approved tenant-scoped environment.
- Deployment work adds the Render skill, while trusted operations retain deployment credentials.
- Independent review uses `vet-autoreview`.
- Source-blind acceptance uses `vet-behavior-validator`.
- GitHub mutation remains in trusted Actions and orchestration code.
- A missing capability causes the trusted maintainer path to add or update the smallest reviewed project skill or adapter, then resume the same issue.

The worker should behave proactively like a capable project maintainer:

- inspect relevant code, docs, history, live state, and prior failure evidence
- infer routine implementation details from repository intent and conventions
- implement complete production-quality behavior rather than a superficial patch
- add regression tests and repair adjacent failures that block the requested result
- validate the real user or operator outcome in the closest safe environment
- keep going through normal retries, repairs, proof, and merge without asking for babysitting
- preserve unrelated work and fail closed for unsafe or genuinely ambiguous product decisions

"Anything relevant to this project should work" is a reliability requirement, not permission to bypass safety.
Requests outside Vet, requiring unavailable account authority, contradicting policy, or risking production data without an approved safe path must reach one concise actionable blocker instead of pretending success.

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

- Both were bot-created and their pull request create or update events used the built-in `GITHUB_TOKEN`.
- Implementation itself succeeded in Crabbox using Vercel Sandbox.
- GitHub deliberately left normal pull request CI and CodeQL `action_required` because workflow-created pull request events used the built-in token.
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

Implementation should record per model call:

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

Cost records must separate:

- model input, cached input, output, and retry cost
- Crabbox provider lease time, storage, network, and estimated incremental cost
- GitHub Actions minutes or included-plan usage
- Render, Hostinger, database, and other fixed subscription cost from incremental issue cost
- human active time, waiting time, interventions, and failed reruns

A prepaid subscription or hosting plan is not literally free.
Report its marginal issue cost separately from its fixed recurring cost.
Do not charge the entire yearly Hostinger or Render bill to one issue.
Do not count subscription-backed Codex as metered API spend, but still record model usage and the fixed subscription context needed for a fair manual comparison.

Token sensitivity means eliminating redundant context and redundant passes, not weakening the acceptance contract.
Use deterministic code for routing, labels, hashes, policy, baseline health, check status, artifact validation, and comment reconciliation.
Use a model only for implementation, semantic review, semantic repair, or proof interpretation where deterministic code cannot decide.
Use the cheapest model that meets the lane contract.
Keep model selection configurable so a stronger model can replace it without rewriting orchestration.

## Execution Environment

Use Crabbox as the single remote execution substrate for model-driven implementation, semantic review, repair, and proof.
Vercel Sandbox is the current primary provider.
GitHub Actions only triggers Crabbox, validates its sealed patch, runs gates, and merges.
Do not maintain a second GitHub-hosted implementation worker.
Every run must report the actual provider and lease ID.

The normal loop must run while the user's Mac is asleep or disconnected.
Hostinger or another always-on service may create issues, but it is not required to execute them.
GitHub owns durable control-plane state.
Crabbox owns ephemeral project environments.

Every model-driven lane should receive an isolated Crabbox lease by default:

- implementation uses `vet-worker`
- independent review uses `vet-autoreview` in a separate read-only or sealed-patch context
- semantic repair uses the same issue and finding ledger in a writable credential-free lease
- no-mistakes runs with the authoritative intent and may produce only a sealed patch
- UI or computer-use proof adds browser or desktop capability and uses `vet-behavior-validator`

If a reviewed tool cannot run through Crabbox and requires a trusted GitHub-native job, document the narrow exception, preserve the same credential separation and exact-head sealing, and do not create a second implementation path.

Every Crabbox checkout includes the selected `.agents/skills` bundle.
The implementation prompt invokes `vet-worker` explicitly.
The bundle includes real review, behavior validation, Vet UI, shadcn, Render, Postgres, and Supabase skills without copying the full personal skill catalog.
`vet-autoreview` belongs to the independent review lane, not the implementation model pass.
The service skills activate only when sealed intent requires them.

Skills do not grant authentication.
Trusted orchestration supplies only the scoped credential needed by the current lane.
Never commit a shared `.env` or expose production credentials to generated code.
For UI work, the Crabbox proof lane must provide a real browser or desktop and verify the requested behavior, not only artifact existence.

## Parallel Copies And Isolation

Multiple valid issues may run concurrently as independent copies of the maintainer workflow.
Each issue receives its own intent digest, branch, pull request, state record, leases, finding ledger, proof bundle, and exact-head gates.
No issue may share a mutable checkout, lease, branch, repair counter, approval, proof result, or model transcript with another issue.

Use deterministic global and per-lane capacity limits.
Queue excess work instead of dropping it, duplicating it, or overloading providers.
Parallelism must not multiply repeated reviews on the same unchanged head.
Replayed events must reattach to the matching issue and lane.
One blocked issue must not block unrelated issues unless a repository-wide baseline or provider-health failure makes further paid work wasteful.

## Authentication And Permissions

Full capability means every required outcome has a trusted authenticated lane.
It does not mean one generated process receives every account credential.
Making the repository private is not a substitute for secret isolation.
Never commit a shared `.env`, personal auth file, browser profile, or reusable production master credential.

Use this split:

- Crabbox provider creation: trusted wrapper receives Vercel or another provider credential; the lease reports its actual provider and lease ID.
- Implementation model: receives only Codex model auth for its single invocation.
- GitHub publication and merge: trusted GitHub Actions jobs own GitHub write permissions; generated code receives none.
- Render deploy and diagnosis: trusted post-merge operations own `RENDER_API_KEY` and the scoped `RENDER_WORKSPACE_ID`; generated implementation code receives neither.
- Production database: Render services retain `DATABASE_URL`; implementation and proof use a disposable or explicitly approved environment instead of a production master URL.
- Browser proof: Crabbox supplies its own browser or desktop; local Mac Chrome auth and personal browser profiles are never copied.

Prefer ChatGPT subscription-backed Codex auth over metered API auth when a supported non-interactive credential exists.
The supported automation credential is `CODEX_ACCESS_TOKEN`, currently available for ChatGPT Business and Enterprise workspaces.
Store it as a secret, expose it only to the Codex invocation, rotate it, and never write it into the checkout or proof.
Do not copy personal `~/.codex/auth.json` into GitHub Actions or a Crabbox lease; OpenAI treats it as password-equivalent, it refreshes over time, and generated code must not be able to read it.
For Plus or Pro accounts without `CODEX_ACCESS_TOKEN`, the current safe unattended Vercel path must retain a scoped API key or move model execution to a private trusted runner.
Authentication mode must remain a configuration choice so adding a supported subscription token does not rewrite orchestration.

`CODEX_ACCESS_TOKEN` setup is deferred by explicit user choice.
Do not pause the core automation work or ask for this token now.
Return to it only after the API-backed production path passes the required canaries, or earlier if the current model credential becomes the sole blocker.
At that time:

1. Recheck current official Codex documentation and workspace eligibility.
2. Create a scoped automation token through the supported ChatGPT workspace flow.
3. Store it in the user secret store and GitHub repository secret without displaying or logging its value.
4. Add token authentication as a configuration-selected mode while retaining the proven API fallback.
5. Run a redacted Crabbox implementation canary through the subscription-backed mode.
6. Remove the API fallback only after the subscription mode proves equivalent reliability and the user approves removal.

Verified bootstrap on 2026-07-24:

- GitHub repository secrets exist for OpenAI API fallback, Vercel Sandbox, Render API access, and the scoped Render workspace.
- On 2026-07-25, the `AGENT_GITHUB_TOKEN` repository secret name was verified present without reading its value.
  Its write scope and approval-free publishing behavior remain unproven until a fresh canary passes.
- The repository is public.
  Actions are enabled, default workflow permissions are write, and workflows may approve pull request reviews.
- External fork workflows still require approval for first-time contributors.
  Do not weaken that boundary; the normal AutoIssue path runs trusted base-branch workflows and must never depend on fork-workflow approval.
- `CRABBOX_VERCEL_READY=true` is configured.
- Local Codex uses ChatGPT sign-in, but no `CODEX_ACCESS_TOKEN` is available.
- The active Render web service is authenticated, not suspended, and has `DATABASE_URL`.
- Render does not currently contain Supabase SDK URL or keys; the current application path uses Postgres `DATABASE_URL`.
- Render Blueprint validation is account-blocked by missing payment information for three paid cron services.
- A redacted zero-model Vercel Sandbox smoke structurally verified every selected Vet skill and exact repository path through Codex, exited successfully, and left no active lease.

Reverify all bootstrap claims before a production rollout because credentials, provider readiness, and account state drift.
The current checkout contains the Crabbox-only model lanes, selected skill bundle, scoped auth bootstrap, semantic behavior proof, shared repair ledger, cost accounting, trusted post-merge verification, and scheduled readiness.
Subscription-token migration and fresh end-to-end issue canaries remain acceptance work.

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

During implementation, distill relevant intent from the Codex session or transcript into a short addendum containing the user's goal, clarifications, and material implementation decisions.
Pass the sealed issue intent plus that addendum to review and no-mistakes.
Do not repeatedly send the raw transcript or let the addendum override the user's request.

Untrusted issue, pull request, and comment text remains data.
It must never become workflow instructions merely because a model can read it.

### What "Use The Transcript" Means

The authoritative source remains the sealed AutoIssue and trusted owner clarifications.
If AutoIssue was created from a Codex or other agent conversation, the trusted issue creator should attach a bounded intent summary and source digest, not the full private transcript.

Crabbox receives:

- the sealed issue intent
- trusted owner clarifications
- the bounded transcript intent summary when one exists
- relevant repository instructions and code

During implementation, Crabbox writes a small structured intent addendum containing:

- decisions made from repository evidence
- routine assumptions used
- scope or acceptance clarifications
- verification and proof decisions
- unresolved questions that actually require the user

no-mistakes receives the sealed issue intent, optional transcript summary, implementation addendum, exact-head diff, deterministic results, and current finding ledger.
This lets no-mistakes review what the user wanted and what the implementer actually decided without repeatedly paying to load or reinterpret a raw transcript.
The addendum may clarify implementation.
It may not rewrite, broaden, or weaken the user's sealed request.

## Reference Systems To Inspect

Read the repository-owned notes below when implementation begins.
Do not copy any system wholesale.
Extract the smallest proven patterns that preserve Vet's own trust boundaries.
`opensrc/sources.json` is the reproducible source inventory.
When a decision depends on current upstream behavior, a trusted preparation step may run `npm run opensrc:sync` before creating the lease and update the repository notes.
The Crabbox implementation worker does not need host-local mirrors or GitHub authentication.

### Sandcastle

Local note: `opensrc/sandcastle/README.md`.

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
Use Crabbox as the default isolation transport for model implementation and repair work.
GitHub Actions may continue to own trusted routing and deterministic checks.
A proofless issue may skip desktop and media capture, but it must not bypass required implementation isolation, exact-head checks, review, or no-mistakes.

Do not assume Vercel readiness because a token or repository secret exists.
Before calling Vercel Sandbox ready, run a redacted live authentication and lease lifecycle smoke that creates, hydrates, executes in, reports, and destroys a sandbox.
If Vercel is unavailable, use another explicitly configured remote Crabbox provider.
The credential-free `local-container` provider is a visual-proof fallback, not a second implementation worker.
Never silently claim Vercel proof when the actual provider was `local-container`.

### no-mistakes

Local note: `opensrc/no-mistakes/README.md`.

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
This user has asked for unattended AFK automation, but the implementation must encode that consent narrowly within repository policy and immutable-head safeguards.
Use no-mistakes heavily as the final semantic review and safe-repair gate, with the sealed issue intent and short transcript-derived addendum supplied explicitly through `--intent`.

## Simple Roadmap: What Happens To One AutoIssue

From the user's perspective:

```text
Create AutoIssue
  -> decide priority, risk, and proof
  -> check that the system is ready
  -> Crabbox implements
  -> CI checks the exact code
  -> independent review and no-mistakes babysit repairs
  -> Crabbox creates proof when needed
  -> merge automatically or ask one real question
```

The user creates one AutoIssue and then leaves it alone.
Submitting the AFK issue form automatically adds `agent:implement`.
Adding `agent:implement` to an existing issue starts the same path.
The user should not need to create a branch, approve a normal workflow, start Crabbox, request review, request proof, poll checks, rerun transient failures, or merge eligible work.

### 1. Seal What The User Wants

Trusted code freezes the issue title, body, acceptance criteria, constraints, requested proof, owner clarifications, and optional bounded transcript summary.
Later model passes use this same sealed intent.
They do not reinterpret an ever-growing raw conversation.

### 2. Decide Priority, Risk, And Proof

These are separate decisions.

Priority controls attention and cost:

- trivial: only the repository owner may choose this before implementation; it skips paid no-mistakes only
- low: small safe docs, tests, copy, narrow cleanup, or isolated maintenance
- medium: normal product work and the default when no stronger rule applies
- high: important or sensitive work that should complete implementation and proof but requires final human review

Trusted triage should decide low, medium, or high from the sealed request and repository policy.
Explicit owner priority is authoritative.
The system may upgrade priority when evidence requires more attention.
It must never invent `priority:trivial` or downgrade an explicit high priority.

Risk controls safety:

- low: narrow, reversible, and easy to prove
- medium: normal application behavior with solid automated proof
- high: auth, security, billing, migrations, production data, destructive work, broad architecture, external integrations, or unclear product policy

Trusted policy computes risk independently from priority.
High risk never auto-merges even when every technical check passes.

Proof controls evidence:

- CI: tests, types, build, lint, audit, scenarios, or deterministic API and CLI checks
- UI: source-blind browser screenshots and assertions
- GIF or video: transitions, loading states, and other time-dependent behavior
- service proof: deployment, logs, health, migration, database, or integration evidence from the trusted lane

Use the strongest proof explicitly requested or required by the affected behavior.
Implementation and review may upgrade proof.
They may not downgrade it merely to save time or tokens.

Start with deterministic policy rules.
Use a small bounded classifier only when policy cannot decide a semantic case.
The classifier may recommend an upgrade or a question.
It may not override explicit owner intent, lower deterministic risk, grant credentials, or approve merge.

### 3. Check Readiness Before Spending Model Tokens

Trusted zero-model checks verify baseline health, required credentials by name, provider readiness, available concurrency, and repository policy.
They verify that `AGENT_GITHUB_TOKEN` exists, authenticates as the configured repository owner, resolves the intended repository, and reports push authorization before any model spend, without printing or exposing its value.
GitHub does not expose a self-inspection endpoint for a personal fine-grained token's complete repository selection and permission set.
Therefore a fresh publisher canary must prove pull-request mutation access and approval-free workflow startup, while the operator remains responsible for creating the token with only the Vet repository selected.
A broken baseline or unavailable provider stops before implementation spend.
Transient infrastructure failure retries or queues automatically.

### 4. Let Crabbox Implement

Crabbox creates an isolated project environment and loads only the relevant Vet skills.
The worker receives the sealed intent, bounded transcript summary when available, repository instructions, and relevant code.
It implements complete production-quality behavior, runs focused tests, and returns a sealed patch plus the structured implementation addendum.
It receives model auth for that invocation but no GitHub write credential or reusable production master credential.

### 5. Publish And Check The Exact Code

Trusted code validates and applies the sealed patch, creates or updates one pull request, and records the exact head commit.
Trusted branch pushes and pull request creation or updates use the repository-scoped credential stored as `AGENT_GITHUB_TOKEN`, never the built-in `GITHUB_TOKEN`.
The publishing credential stays in the trusted lane and is never passed to Crabbox, generated code, pull request jobs, logs, comments, or artifacts.
The built-in token remains available for narrowly scoped base-branch statuses, comments, and workflow dispatch that do not create or update pull request code.
Every agent-created or agent-updated head must start required pull request CI and CodeQL without a maintainer approval or an `action_required` run.
Missing, expired, under-scoped, or approval-producing publishing auth is a readiness failure and stops before further model spend.
Do not weaken external-fork approval policy or execute pull request code through a privileged `pull_request_target` workflow to bypass this requirement.
CI runs against that exact head.
Deterministic failures return focused evidence without spending another full review pass.

Recorded correction on 2026-07-25:
The earlier requirement to introspect every fine-grained personal-token permission before model spend was replaced with the strongest non-mutating checks GitHub exposes plus a fresh production-path publisher canary.
GitHub documents endpoint permission requirements but provides repository-selection inspection only to organization administration through a GitHub App, not to a personal token inspecting itself.

### 6. Let Review And no-mistakes Babysit The Pull Request

The independent reviewer checks the exact head against the sealed intent and records actionable findings in one shared ledger.
After deterministic checks can pass, no-mistakes receives the same intent, transcript summary, implementation addendum, exact diff, test evidence, and remaining findings.
no-mistakes performs the final semantic review and may propose a safe sealed repair.

When a real repair changes code:

1. Crabbox or the approved isolated repair lane produces a new sealed patch.
2. Trusted code publishes the new exact head.
3. Focused CI, independent review, and no-mistakes run again against that head.
4. Resolved findings stay resolved and unchanged findings are not rediscovered from scratch.

Allow at most three material revision heads across the whole shared review loop.
Polling, provider retries, malformed-output retry, and reattaching to an active no-mistakes run do not consume a revision.
Stop early when the head and findings are unchanged.
Do not keep spending tokens merely because another nominal pass remains.

### 7. Create Real Proof

If deterministic proof is enough, record it without starting a desktop.
If browser, visual, data, integration, or deployment proof is required, run the appropriate Crabbox or trusted service lane automatically.
Each sealed acceptance clause records one or more required evidence lanes such as deterministic, browser, or trusted service evidence.
The strongest requested overall proof may add an artifact requirement, but it must not force non-browser clauses into a browser plan.
The browser plan must cover every browser-assigned clause, while CI, API, CLI, or service results cover their assigned clauses.
The trusted finalizer combines the lane results and may pass only when every sealed clause has the required direct evidence.
Proof must show the requested behavior, not merely that an artifact file exists.

Recorded correction on 2026-07-25:
The capsule version advanced from v3 to v4 because adding sealed per-clause evidence lanes changes the intent digest.
Trusted reconstruction retains compatibility with v1 through v3 capsules.

Recorded correction on 2026-07-25:
Replaying an older exact merge during post-merge recovery could roll Render back after newer merges.
Recovery first observes the selected `main` revision and otherwise requests Render's latest configured branch without a commit pin.
The returned deployment must contain the merge, remain on current `main`, and descend from the prior live revision.

Recorded correction on 2026-07-25:
Live evidence showed Render had not materialized the current automation-only `main` commits, so observation-only recovery could never finish.
The latest-branch request preserves automatic recovery without replaying a stored older SHA.

### 8. Finish Automatically

- Eligible low- or medium-risk work: merge, verify post-merge health, close the issue, and clean temporary labels.
- High-priority or high-risk work: finish implementation, checks, review, no-mistakes, and proof, then request only the final policy decision.
- Unsafe, contradictory, impossible, or materially underspecified work: preserve completed evidence and ask one concise actionable question.
- Transient failure: resume the same run without duplicate model work, branches, pull requests, leases, or comments.

If proof preparation fails, finalization publishes the original blocker and a terminal result without decoding an absent request or outcome.
Cleanup and reporting failures may add bounded secondary evidence, but they must never replace the primary failure with a parsing or transport error.

That is the complete normal loop.
One AutoIssue should produce one understandable outcome, not a collection of half-finished workflows.

## Trusted Control Plane

The redesign should converge on one trusted state machine.
Names may change, but responsibilities should stay clear.

1. A trusted base-branch dispatcher receives the issue label event.
2. A zero-model preflight checks repository baseline health, Crabbox and Vercel readiness, required credentials, concurrency, and policy before paying for implementation.
3. Trusted code seals the bounded intent capsule and immutable issue snapshot.
4. A worker lease is created through Crabbox for implementation and semantic repair.
   Desktop, browser, and media capabilities are added only when proof needs them.
5. The implementation model receives only the capsule, relevant repository instructions, a bounded code slice, and deterministic feedback.
   It returns a patch plus the short transcript-derived intent addendum.
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

Allow at most three genuine semantic repair cycles by default across the entire issue attempt.
A cycle means that a model receives findings and produces a materially new candidate head.
Use one trusted shared counter and finding ledger across independent review and no-mistakes.
Do not give each tool its own full three-cycle allowance.
Internal focused retries that do not produce a materially new candidate head do not consume the shared budget.
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

Bot-created pull requests must not use the built-in `GITHUB_TOKEN` for create or update events that GitHub holds for maintainer approval.
The trusted publisher should use `AGENT_GITHUB_TOKEN`, base-controlled dispatch, and exact-head verification while preserving GitHub's security boundaries.
Never solve approval friction by giving untrusted model code write credentials or weakening branch protection.

## Recovery And Idempotence

Every expensive stage needs a stable idempotency key derived from issue, attempt, exact head, lane, intent digest, and relevant configuration digest.
Replayed events should reattach, reconcile, or no-op.
They should not create another branch, pull request, model run, proof lease, or comment.

Historical failed pull requests do not need recovery.
After their evidence is captured, they may be closed and replaced by fresh canaries.
Recovery requirements below apply to new active runs so a temporary failure does not waste completed work or force the user to restart manually.

Persist enough trusted state to resume after:

- runner cancellation
- delayed checks
- provider interruption
- mergeability changes
- exact-head replacement
- no-mistakes client timeout while its daemon remains active

If an active no-mistakes run exists for the same branch and head, reattach to it.
Do not abort and restart merely because a synchronous client timed out.

## Readiness Guarantee And Acceptance

Do not use pull requests 37 or 38 as the final acceptance run.
They remain diagnostic evidence.

The practical guarantee is evidence-backed readiness, not a promise that external services will operate unchanged forever.
Do not tell the user "this will work next time" until all required fresh canaries pass through the same production GitHub path the user will invoke.
After readiness, keep a zero-model health check running so expired authorization, provider drift, action deprecations, baseline failures, and branch-policy changes are detected before the next paid run.

Use fresh canaries:

- Proofless canary: a harmless but useful documentation change, such as correcting or adding a README link.
- Proof-required canary: a stable test route or hook that exposes a loading transition long enough for deterministic capture.
  Start recording before navigation and verify both the loading state and final page.
- Health canary: a zero-model scheduled preflight that reports whether required checks, provider readiness, and baseline audit can support a new AFK run.
- Recovery canary: deliberately interrupt one safe stage, then prove the same run resumes without duplicate model work, branches, pull requests, proof leases, or comments.

Also run a representative project capability suite before broad readiness is claimed:

- repository lane: implement and verify a safe code or configuration change
- UI lane: implement a visible change and prove it source-blind in a real browser
- data lane: validate a migration and tenant-scoped read or write against a disposable database
- deployment lane: prove trusted Render configuration, deploy observation, logs, and health without exposing credentials
- policy lane: submit one unsafe or materially underspecified request and prove it blocks once with one useful question

These cases prove routing and trust boundaries.
They do not authorize disposable production changes or weaken exact-head issue canaries.

Before those issue canaries, prove the configured Crabbox provider lifecycle:

1. Resolve the pinned or repository-selected Crabbox binary and report its version.
2. Verify the selected provider through redacted live authentication.
3. Acquire a real lease.
4. Hydrate the exact test checkout.
5. Run a representative command from the user-facing path.
6. Collect timing and result metadata.
7. For proof infrastructure, launch the required browser or desktop and collect a real artifact.
8. Report the actual provider and lease ID.
9. Stop the lease and verify cleanup.
10. Repeat the minimum proof through the configured fallback so provider failure has a tested recovery path.

For each canary, verify:

- one issue produces one branch and one pull request
- no maintainer workflow approval is needed during the normal trusted path
- a fresh agent pull request and a reviewer repair both start required pull request workflows without any `action_required` run
- no duplicate implementation, review, proof, or no-mistakes run occurs
- required checks bind to the exact head
- proofless low- or medium-risk work merges automatically
- proof-required work produces semantically valid proof before merge
- mixed UI and deterministic acceptance clauses receive their correct evidence lanes and combine into one complete result
- proof preparation failure reports its original blocker instead of a missing-output decoding error
- managed status output remains concise
- token and cost accounting is complete
- no secret value appears in logs, comments, artifacts, or model context
- the exact pull request head that passed CI, review, no-mistakes, and proof is the head that was merged

Run the two issue canaries independently, then run them close enough together to exercise concurrency and slot controls.
Repeat any failed canary after the fix from a fresh issue.
Do not count a manually repaired old pull request as acceptance.

The system is ready only when:

- proofless low- or medium-risk work automatically merges and closes its issue
- proof-required work produces semantically correct evidence and then follows merge policy
- Vercel Sandbox passes its lifecycle smoke if it is the selected primary provider
- the Crabbox fallback passes its lifecycle smoke
- interruption recovery causes no duplicate expensive work
- scheduled health reports ready
- all deterministic repository gates pass from current `main`
- the operator documentation exactly matches observed behavior

Pin critical action and Crabbox versions or checksums.
Test updates before promotion.
Use scheduled readiness checks and actionable alerts to keep the system working over time.
No design can guarantee that GitHub, Vercel, model APIs, or other external services will work unchanged forever, so permanence means detecting drift early, failing safely, and keeping a tested fallback.

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

## Execution Start

Follow one critical path.
Do not start a live canary while a known local, workflow, credential, or contract blocker makes success impossible.
For each stable implementation checkpoint, run focused checks first, run the full deterministic suite once after known blockers are cleared, and only then spend on the next live canary.
Do not repeat an already passing expensive capability test unless changed code can affect that capability.
After each implementation, local-proof, and live-proof milestone, publish one concise status with completed evidence, the current blocker, and the next remaining phase.

1. Read root `AGENTS.md`, this file, `.agent/agent-policy.md`, `docs/agent-automation.md`, and relevant scoped instructions.
2. Inspect `git status -sb`.
   Preserve all unrelated work.
3. Read the complete current diff and inventory the existing AFK work.
   Continue from it unless verified evidence rejects a specific change.
4. Do not pull, switch branches, or rebuild from a clean checkout while the current work is uncommitted.
   Checkpoint safely before any synchronization that could disturb it.
5. Refresh live GitHub issue, pull request, workflow, branch-protection, secret-name, variable, and approval-policy evidence without exposing values.
6. Read the repository-owned OpenSRC notes for Sandcastle, OpenClaw, Crabbox, and no-mistakes.
   If current upstream behavior is required, refresh it on a trusted host before creating the Crabbox lease.
7. Reproduce the end-user failure path and confirm the known blockers before changing their code.
8. Reconcile current implementation and operator docs with this contract.
   Prioritize complete triage decisions, transcript intent propagation, one shared three-revision budget, cost accounting, post-merge verification, and scheduled readiness.
9. Implement in small verified stages with regression tests.
10. Run focused tests after each stage.
11. Run the full deterministic suite and security audit.
12. Run the full primary and fallback Crabbox provider lifecycles.
13. Run fresh proofless and proof-required issues independently through the production GitHub path.
14. Run recovery and near-concurrent canaries and prove no duplicate expensive work.
15. Verify exact-head merge, issue closure, proof semantics, post-merge checks, service health, concise status output, and cost records.
16. Run no-mistakes or the repository-required equivalent closeout review until no accepted actionable findings remain.
17. Reconcile `AGENTS.md`, this file, and `docs/agent-automation.md` with observed behavior.
18. Claim readiness only when every acceptance item passes.
    If an external blocker remains, report its exact evidence and smallest required user action, then continue immediately after it is resolved.

## Implementation Order

Use this order unless evidence shows a safer dependency order.

1. Preserve and understand the current working diff.
2. Seal issue intent and optional bounded transcript context once.
3. Implement the trusted priority, risk, and proof decision with deterministic floors and bounded semantic fallback.
4. Make zero-model readiness and baseline checks fail before any paid implementation lane.
5. Wire trusted branch and pull request publishing to `AGENT_GITHUB_TOKEN` and prove agent updates trigger required workflows without approval.
6. Finish the Crabbox-only implementation and repair transport with scoped credentials and structural skill discovery.
7. Converge model-driven implementation, independent review, repair, no-mistakes, and proof on isolated Crabbox execution or document the smallest trusted exception.
8. Produce the bounded implementation addendum and pass the same authoritative intent to review, no-mistakes, and proof.
9. Replace repeated independent repair limits with one shared three-revision ledger.
10. Deduplicate unchanged heads and findings and reattach to active no-mistakes work.
11. Route each acceptance clause to its required evidence lanes and combine the results without weakening proof.
12. Upgrade proof requirements when implementation or review discovers stronger evidence needs.
13. Bind CI, review, no-mistakes, proof, bypasses, approvals, and merge to the same exact head.
14. Add trusted post-merge verification and concise failure recovery.
15. Add complete model, provider, fixed-service, and human comparison cost records without recording sensitive model context.
16. Add scheduled zero-model readiness monitoring and actionable drift reporting.
17. Complete representative repository, UI, data, deployment, and policy capability tests.
18. Complete all local, provider, production-path, recovery, and concurrency acceptance tests.
19. Return to subscription-backed `CODEX_ACCESS_TOKEN` as a cost optimization after reliability is proven.

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

Final target: 10/10 production-grade automation, maximally token-efficient for the current model without materially reducing quality; later Codex model upgrades must remain a configuration change, and production-quality code remains required.
