---
summary: "V1: Quick conversation preparation: client asks, existing strengths, gaps, and the current integration-first direction."
read_when:
  - Preparing to discuss the client's shared ChatGPT prompts
  - Explaining what exists without committing to a new implementation plan
---

# V1 - Conversation brief

September 13, 2026. Read this first for the short version. The [original client prompts](client-requests.v1.md), [full source notes](project-goals.v1.md), and [separate recommendations](product-direction.v1.md) retain the detail.

**V1 identifies the document set prepared in this conversation.** It is a document version, not a product release or a claim that the proposed features are implemented. Source records contain the original speakers' words; this brief and the recommendations are assistant-authored.

## What the client actually asked you to do

1. Explain OpenVet AI and whether something similar could be built.
2. Analyze the practice's reviews and identify the five biggest customer pain points that software could address.
3. Walk through the proposed solution before building it.
4. Explain whether DataHub can read Cornerstone's database without Cornerstone API keys, and draft the vendor questions.

The forwarded chat does not establish an agreed specification for a clinical copilot. The long feature lists and installation advice in the AI responses were suggestions. Your separate product/agent transcripts contain the broader vision; they should not all be attributed to the client.

The useful direction in his requests is evidence from real customer reviews, a manageable top-five prioritization, and a walkthrough before implementation. Those ideas align with the customer-first goals already in your own notes.

For context, [OpenVet's current site](https://www.openvet.ai/) presents clinical reasoning with patient records and cited evidence. Our inspected foundation focuses on clinic operations and the client journey. The client's mention is a reference to explore; his prompts do not settle how much clinical functionality belongs in our product.

## What we have, what is worth keeping, and what is missing

This reflects the source inspection and local checks already performed, not new production verification.

| Area | What exists and is worth keeping | What is missing or unproven |
| --- | --- | --- |
| Shared product | One Next.js app with tenant-aware data and hospital branding | End-to-end proof that every pilot path uses the right live hospital data |
| Clinic workflow | Arrival questionnaire, room/status workflow, staff tasks, client journey, follow-up and analytics foundations | Real clinic observation, real-data mapping, and reliable completion of the whole workflow |
| Agents | Client/staff separation, typed tools, audit/memory foundations, Google ADK and deterministic paths | Proof of live outcomes; proposed specialist hierarchy and wider autonomy are not settled |
| DataHub | Ingestion/storage foundation and documented sandbox traffic; user expects syncing to be ready by the next build session | Verification of the expected live sync and the connection from received records into product reads; inspected key flows still use mock tables |
| Communication | Message planning, follow-up and delivery controls | Approved real recipients/settings and proven customer delivery/replies for the pilot |
| Larger ambitions | Booking and pricing demonstration/report paths | Proven production booking, payments, autonomous price changes, clinical copilot, and Cornerstone replacement |
| Customer evidence | Exact client request, candidate themes, and 54 historical Google-labeled testimonial cards saved from the clinic website | Complete Google/Yelp dataset and evidence-backed top-five ranking; the sample contains only four/five-star reviews and 23 truncated texts |

The strongest parts to retain are the common hospital-configurable product, clear tasks and visit status, tenant boundaries, and existing integration/agent interfaces. They provide a base for the eventual product. Which experiences customers specifically like remains a review-analysis question; it has not been established from a complete dataset.

## What you can say in the conversation

“I understand the request: use the reviews to find the biggest customer problems, show how the software could address them, and discuss it before building. We already have a useful workflow foundation and a sandbox integration. I expect the real Cornerstone connection to be ready for our next build session; we will verify the sync and connect the workflows to that data then. I plan to resume development when I have capacity. Longer term, I want this product to take over the work currently handled by Cornerstone.”

## Answers to have ready

| If he asks | Your answer |
| --- | --- |
| Can you build something like OpenVet? | We can explore the particular capabilities you find useful. Our current foundation is the clinic workflow and client journey. Clinical decision support would need its own scope and validation. |
| How much is already built? | We have check-in, visit status, staff tasks, follow-up, and integration foundations. Important paths still use mock data, so I am not calling the full live workflow finished. |
| Does DataHub avoid needing Cornerstone API keys? | The vendor says a dedicated read-only database account is supported. It still needs authorized installation and database access; that is different from having no credentials or permissions. We will verify the installed setup. |
| What are the five biggest complaints? | We do not have a defensible ranking yet. The saved website sample is historical and positive-only. We need broader Google/Yelp coverage before selecting the top five. |
| When will this be ready, and will it replace Cornerstone? | I expect integration to be ready for the next build session, and I will resume when I have capacity. We will first prove one complete workflow with real data. Replacing Cornerstone is the longer-term direction, with migration scope still to agree. |

The useful outcome of this conversation is agreement on the customer problem to investigate first and how to obtain review coverage. A delivery date or full feature specification can wait until the real-data path is verified.

## Keep the immediate discussion small

- DataHub status is answered for this discussion: expected to be syncing by the next build session, with successful live operation still to verify.
- A complete review export may later need the clinic's Google Business Profile access or an existing export. This does not need to hold up the present brief.
- Acknowledge the intended outcome and that product planning resumes later. Do not commit to a clinical feature list, delivery date, or automatic booking/payment policy now.

Google provides a no-charge API route, subject to account authorization and approval. Unofficial tools use browser scrolling and pagination; completeness depends on actual access. The direct test recovered the clinic's historical testimonial sample, but Yelp blocked a direct download and a complete free export remains unverified. The [review-collection findings](product-direction.v1.md#requested-review-collection-google-and-yelp) explain the tools, results, and sources. Review collection does not technically depend on the PIMS integration. No further question is needed for this preparation pass.

## Draft reply

The [local email draft](.local/client-reply.v1.md) is addressed to the client who shared the ChatGPT conversation. It has not been sent. A response addressed to the integration vendor would need different wording.

## Find the V1 documents

- **Read first:** this conversation brief and the [V1 email draft](.local/client-reply.v1.md).
- **My analysis:** [V1 product direction](product-direction.v1.md), including the diagrams, current gaps, and review-collection findings.
- **Your wording preserved:** [V1 project goals](project-goals.v1.md) and [V1 agentic startup](agentic-startup.v1.md).
- **Other supplied wording preserved:** [V1 client requests](client-requests.v1.md) and [V1 agent-rules reference](reference-agent-rules.v1.md).
- **Email decisions summarized:** the marked [V1 addition in the existing DataHub runbook](datahub.md#pilot-decisions-from-supplied-correspondence).
- **Verbatim decisions:** [V1 preservation ADR](adr/0001-preserve-original-requests.v1.md) and [V1 mainline ADR](adr/0002-consolidate-on-main.v1.md). Their contents are unchanged; only their filenames gained the version label.
