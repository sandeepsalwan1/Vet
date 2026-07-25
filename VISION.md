# VISION.md

Vet helps veterinary hospitals run Client request intake, Arrival intake, staff follow-up, and care coordination with less manual queue work.
Use this file only before issue creation, while deciding whether to create and then drafting a new issue.
After an issue is created, the issue itself is the source of truth for implementation, review, and proof.
This file is product direction, not a backlog, roadmap, hosting plan, or automation design.

## Product Direction

- Build a real B2B product for real veterinary hospitals and customers.
- Start with real Clients, Veterinarians, Staff, and Admin.
- Understand their actual problem before proposing a feature or technical change.
- Turn messy requests into clear, trackable clinic work with safe defaults and a reliable audit trail.
- Proactively propose worthwhile improvements that align with this direction.
- Improve the overall product experience, not an isolated screen or clever technical idea.
- Make routine veterinary workflows feel obvious, calm, fast, and dependable.
- Prefer useful improvements to existing workflows before adding new product surface area.
- Add a feature only when it solves a clear user problem and belongs in Vet.
- Keep the product focused and avoid unnecessary options, concepts, pages, and maintenance.
- Treat the conversational agent as a primary product surface.
- Give the agent safe, authorized access to every relevant product capability instead of leaving new features usable only through buttons.
- Keep Staff focused on daily operational work.
- Treat Veterinarian as a distinct clinical role with staff-like workflows and protected clinical ownership.
- Give Admin clear clinic-wide controls, recommended defaults, and an audit trail showing who did what.

## Simplicity Standard

- The UI should be concise, clear, and visually calm.
- Use plain language that a non-technical veterinary client or hospital team member understands immediately.
- Each screen should make its purpose and next action obvious.
- Remove unnecessary copy before adding instructions, tooltips, or help content.
- Show advanced detail only when the user needs it.
- Use the task board as the standard for a clean, minimal operational surface.
- Keep Staff screens minimal while giving Admin powerful but understandable customization.
- Pair configurable controls with clear, evidence-backed recommended defaults.
- Prefer existing Shadcn or Hero-style components when they improve consistency and human feel.
- Treat awkward spacing, stray elements, unnecessary controls, and obvious visual bugs as real defects.
- A user should not need training or a video to understand the normal workflow.
- Do not expose internal system, agent, database, or workflow terminology in the product UI.

## Customer-First Issue Test

Create an issue only when the answer to these questions is clear:

- Who experiences the problem?
- What are they trying to accomplish?
- What is confusing, slow, repetitive, unreliable, or missing today?
- What is the smallest improvement that meaningfully solves the problem?
- How will we prove the experience became better?
- Why does this belong in Vet now?

Strong issues usually:

- reduce confusion, steps, repeated entry, waiting, or manual follow-up
- make an existing workflow easier to understand or complete
- fix a real reliability problem that affects users
- make important information or the next action clearer
- connect a missing part of a real customer or hospital workflow
- remove product friction or unnecessary complexity
- add a relevant feature with an evidenced user need

Do not create issues that:

- add speculative features without a concrete user problem
- add settings, dashboards, agents, abstractions, or infrastructure because they might be useful later
- make the UI wordier to compensate for unclear product design
- duplicate an existing or recently completed issue
- create broad rewrites when a smaller user-facing improvement solves the problem
- optimize for technical novelty instead of customer value
- add unnecessary product bloat
- touch secrets, authentication, billing, production data, or migrations without explicit human review
- conflict with `CONTEXT.md` or `docs/architecture.md`
- lack a credible test or proof path

## Duplicate Check

Before creating an issue:

1. Read the titles of the 20 most recently created issues, including open and closed issues.
2. If the repository has fewer than 20 issues, read every issue title.
3. Compare the proposed outcome with those titles.
4. Do not create the issue when the same or substantially similar problem is already open, completed, or recently attempted.
5. Improve or continue the existing issue instead when that is the clearer path.

Titles are enough for this first duplicate check.
Inspect an issue body only when its title might overlap with the proposed work.

## Issue Quality

- Use one issue for one clear user outcome.
- Write the title as the improvement a user should experience.
- State the affected user, current problem, desired outcome, acceptance criteria, and required proof.
- Keep implementation suggestions out unless they are necessary to define the product behavior.
- Choose any scope needed to solve the real customer problem, but keep one clear outcome.
