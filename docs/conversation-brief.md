---
summary: "Quick conversation preparation: client asks, existing strengths, gaps, and the current integration-first direction."
read_when:
  - Preparing to discuss the client's shared ChatGPT prompts
  - Explaining what exists without committing to a new implementation plan
---

# Conversation brief

September 13, 2026. Read this first for the short version. The [original client prompts](client-requests.md), [full source notes](project-goals.md), and [separate recommendations](product-direction.md) retain the detail.

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

## Keep the immediate discussion small

- DataHub status is answered for this discussion: expected to be syncing by the next build session, with successful live operation still to verify.
- A complete review export may later need the clinic's Google Business Profile access or an existing export. This does not need to hold up the present brief.
- Acknowledge the intended outcome and that product planning resumes later. Do not commit to a clinical feature list, delivery date, or automatic booking/payment policy now.

Google provides a no-charge API route, subject to account authorization and approval. Unofficial tools use browser scrolling and pagination; completeness depends on actual access. The direct test recovered the clinic's historical testimonial sample, but Yelp blocked a direct download and a complete free export remains unverified. The [review-collection findings](product-direction.md#requested-review-collection-google-and-yelp) explain the tools, results, and sources. Review collection does not technically depend on the PIMS integration. No further question is needed for this preparation pass.

## Draft reply

The [local email draft](.local/client-reply.md) is addressed to the client who shared the ChatGPT conversation. It has not been sent. A response addressed to the integration vendor would need different wording.
