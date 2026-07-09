# VISION.md

Vet helps a veterinary clinic run Client request intake, Arrival intake, staff follow-up, and care coordination with less manual queue work.

## North Star

Turn messy client and staff requests into clear, trackable clinic work:

- capture request
- validate details
- create staff task
- notify the right person
- keep an audit trail
- avoid dropped follow-ups

## Product Principles

- Staff speed over flashy UI.
- Safe defaults for client, patient, and clinic data.
- Every automated action leaves traceable proof.
- Prefer small, shippable workflow improvements.
- Agent work must improve real clinic operations, not create speculative churn.

## Agent Issue Policy

Agents may propose issues when they:

- reduce manual staff work
- improve Client request reliability
- improve Arrival intake reliability
- improve task accuracy
- improve notification correctness
- fix clear UX friction
- add tests or proof for fragile flows
- simplify maintenance without changing behavior

Agents should reject or defer issues when they:

- touch secrets, auth, billing, production data, or migrations without human review
- conflict with `CONTEXT.md` or `docs/architecture.md`
- are vague, aesthetic-only, or speculative
- require real clinic policy decisions
- cannot be proven with CI, tests, or explicit manual acceptance
