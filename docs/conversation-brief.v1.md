---
summary: "V1: Quick answers on the client's asks, existing product, gaps, and integration timing."
read_when:
  - Preparing for the client conversation
  - Explaining what exists and what still needs work
---

# V1 - Conversation brief

September 13, 2026. Assistant summary. [Original client wording](client-requests.v1.md) is preserved separately.

**He wants:** explain OpenVet, use the practice's reviews to identify the five biggest customer problems, walk through the proposed software before building, and clarify DataHub's access to Cornerstone.

**OpenVet:** a veterinary clinical-assistance product. Its [email workflow](https://www.openvet.ai/resources/openvet-opens-to-every-licensed-veterinarian-free) accepts clinical questions and blood-test results. It is a reference to explore; the shared chat does not define an agreed clone specification.

**The useful direction:** work backwards from customer complaints and discuss the solution first. We cannot infer that he approved the earlier AI-generated feature lists.

| We have | Still missing or unproven |
| --- | --- |
| Check-in, visit/room status, staff tasks, follow-up, tenant boundaries | One complete workflow proven with live clinic records |
| DataHub ingestion and historical sandbox proof | Confirmed live sync and connecting received records to product reads; key paths still use mock tables |
| Agent tools, audit/memory and message planning | Proven live automation, pilot email replies and clinician-reviewed result interpretation |
| [Google and Yelp exports](reviews.md) for Tri-City and Woodminster | Deduplicated, clinic-specific top-five findings and coverage assessment |

**DataHub answer:** the vendor says a dedicated read-only database account is supported. Cornerstone API keys and authorized database access are different things; installation still requires permissions. See the [email commitments](datahub.md#pilot-decisions-from-supplied-correspondence).

**Current timing:** DataHub says setup is ready and asks to activate read-only sync. Activation is unconfirmed. Let it run for about a week once enabled, inspect actual records, then choose the next build when you have capacity. Longer term, the goal is to replace Cornerstone.

**Additional ideas you relayed:** email-response assistance, interpretation of emailed results, and OpenVet/Eight Sleep service patterns. Original wording remains in [client requests](client-requests.v1.md). Select features using [ADR 0001](adr/0001-new-features.v1.md).

**What to say:** "I understand the goal: use the reviews to find the biggest customer problems and walk through the solution before building. We already have the workflow foundation. Once the read-only integration has run for about a week, I'll inspect the real data and use it to choose the next build."

Implementation evidence and source references are in [product direction](product-direction.v1.md).
