---
summary: "V1: Original client prompts and additional requests relayed by the user, preserved verbatim."
read_when:
  - Checking what the client actually requested before relying on earlier AI responses
  - Discussing email-response assistance or interpretation of emailed clinical results
---

# V1 - Client requests

Source: the supplied shared ChatGPT conversation beginning August 30, received September 13, 2026. Requests 1-4 are its four visible user turns, copied exactly. AI responses and the AI-written email draft are omitted. The conversation contains no actual review corpus or completed review analysis. Later additions relayed by the user are recorded separately below, with their source distinguished from the shared chat.

## Request 1

````text
What’s openvet ai and is this something you can make?
````

## Request 2

````text
Analyze all the reviews for the practice and build a software that can address the top five pain points that customers express
Don’t build it yet walk me through it first
````

## Request 3

````text
Is Datahub able to read SQL database without getting access keys from cornerstone?
````

## Request 4

````text
Draft email to Datahub asking these questions
````

## Additional requests relayed by the user - September 13, 2026

Source: the user's follow-up in this conversation. This is their account of additional desired capabilities, not another extracted turn from the client's shared chat. Status: captured for later discussion and implementation planning.

### Original wording

````text
Okay, I think there was some other stuff he wanted to add. I think you should add it somewhere. I think client requests. For example, when we get an email from the client saying, "Hey, when our thing is done," that makes sense, right? We should definitely absolutely do this, right? Maybe we need to figure out what that one is, but basically, an open claw, right, to be able to easily make the email responses.

Another thing that we want to add in is that whenever we get some kind of result via email, it should give some kind of diagnosis as well, which is not that complicated.
````

### Working interpretation - assistant-authored

1. **Email-response assistant:** receive a client email, understand the request, retrieve the relevant verified clinic information, and prepare an appropriate reply. Interpret "an open claw" as an OpenClaw-style assistant reference for now; a particular framework has not been selected. The example "when our thing is done" needs clarification before defining a specific status workflow. A reply must not invent completion, timing, or availability.
2. **Interpretation of emailed results:** receive a clinical result by email, match it to the correct patient, and prepare a result summary and possible diagnostic interpretations using the patient's available clinical context. The proposed first behavior is a draft for veterinarian review, with uncertainty and missing context visible. Results alone do not always establish a diagnosis. Clinical advice should be reviewed by a veterinarian before being sent to a client.

Details to settle when building: the mailbox and result formats, which status requests are in scope, and whether routine nonclinical replies are drafts or automatically sent. These interpretations are proposals; the original request above remains the source of truth.

## OpenVet and Eight Sleep references - September 13, 2026

Source: the user's next clarification in this conversation. Status: desired product direction and research scope; individual features and implementation choices remain to be agreed.

### Original wording

````text
Or, because that's what we need to copy, whatever we want to copy OpenVet. I think that's kind of what they wanted, right? Yeah, I think some of the guys would be pretty good. Another thing we want to add: everything we could possibly do, like emails. We probably need to do a lot of research too. For example, a company I saw this done recently was called Eight Sleep, where all their responses were just emails and stuff, so we need to kind of copy that.
````

### Working interpretation - assistant-authored

- **OpenVet is a product reference:** study and reproduce the useful clinical-assistance workflows for this clinic, including interpreting emailed results, patient-context retrieval, clinical research with sources, summaries, and follow-up. The original client explicitly asked about OpenVet; this clarification strengthens the user's desire to adopt useful capabilities. It does not establish a complete feature list approved by the client.
- **Eight Sleep is a service reference:** study how a customer can start and continue a useful service interaction by email, with the assistant retrieving relevant information and advancing the request to a verified outcome. Preserve context across replies and provide an owned human handoff when needed. The user's experience is the reference; whether all Eight Sleep responses are automated has not been established.
- **Research the full opportunity:** inventory useful email workflows, including routine questions, status updates, appointment requests, records requests, estimates/invoice explanations, results, care follow-up, and complaint resolution. These are candidate workflows to investigate, not a commitment to implement every one immediately. Separate operational replies from clinician-reviewed interpretations and identify what real clinic data each needs.

Initial source checks and open research items are summarized in [product direction](product-direction.v1.md#openvet-and-eight-sleep-as-references). The intended outcome is a clinic-specific assistant that helps complete work through email as well as the app.

At the user's request, the two later source passages above are also recorded verbatim as the first ADR: [0001 - New features](adr/0001-new-features.v1.md). The assistant-authored interpretations remain separate from the decision text.
