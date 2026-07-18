# Customer Journey Review Decisions

Status: Reopened on July 16, 2026. Previous UI implementation approval withdrawn. A Render preview deployment was authorized on July 17 so the current implementation can be inspected; fresh UI approval is still required before treating it as the accepted product design.

Source: Lavish session `e310e898400903fc`, its delivered feedback batches, and the user's July 16 correction in the main conversation.

## Exact latest feedback

> Okay, really make sure of this:
>
> 1. I need to be able to see the official Tri City, the full thing, right?
> That one should be working, so if I go to tricityvet.ebitch.com, it should be working now.
>
> 2. That really pissed me off: this lavish thing.
> Make sure whatever annotation I do is going to be added, and make sure you literally add it.
> Do not surprise the guy.
> Literally everything you do should be clear.
> I have no idea what you're doing with UI, so that was really annoying.
> I didn't even know where you could do the UI at.
> That was so trash.
> I didn't even know how it was going to look.
> I did not like those changes you did, to be honest.
> I did the plan even, and still it did trash edits.
> I don't know, just really fix your lavish plan.
> Make sure it's literally good, better, and there are no surprises and things.
> It should be a plan, right?
> It shouldn't be some kind of shock when I see some random shit.

Correction:

> i meant tricityvet.eepish.com ignore my typos

Status: Applied to the plan and Lavish skill. Product implementation and deployment remain pending fresh UI approval.

## Substantive annotations and resolutions

1. Keep the product clinic-agnostic and customizable.
Resolution: Tri-City is the current design-partner profile, not a product-wide hardcode.

2. Send the next-day pet check only after a positive visit response.
Resolution: A negative visit response creates a service-recovery task and staff call; that human workflow owns the next contact and suppresses the automated pet check.

3. Correct the preparation diagram label from `pre- check-in` to `pre-check-in`.
Resolution: The Mermaid source uses the corrected label.

4. Make reminder timing and channels configurable.
Resolution: Tenant settings control cadence and channels without product-code changes.

5. Prefer email for detailed messages and use SMS selectively to avoid over-messaging.
Resolution: Email remains the detailed/default channel; SMS requires consent and is limited to useful touchpoints.

6. Guarantee a 24-hour appointment SMS.
Resolution: Every SMS-consented client receives the 24-hour reminder unless the appointment is canceled or rescheduled, or the client opts out.

7. Do not replace or broadly redesign returning-client sign-in.
Resolution: Existing sign-in and forgot-password paths stay intact.

8. Change only new-client account setup.
Resolution: A new client claims an account with the email or phone already on the clinic record; the product verifies a matched contact and sends unmatched claims to staff review.

9. Use the requested Tri-City welcome language across relevant messages.
Resolution: The welcome says Tri-City is family-run since 1986, represents three generations of service, and explains how the clinic makes visits pleasant and easy.

10. Explain what happens during a visit in the welcome and appointment preparation messages.
Resolution: The client checks in, gets questions answered, meets a technician or veterinary assistant for clarifying questions, and the pet moves to the treatment room where another assistant supports the doctor during the exam.

11. Reduce the welcome process from four steps to three.
Resolution: The care-plan, update, checkout, and follow-up language is combined into the third step.

12. Tell transferring clients to provide records before the appointment.
Resolution: Appointment preparation asks clients to upload prior medical and vaccine records through the portal.

13. Require another confirmation before releasing records.
Resolution: A client records request creates a staff task. Authorized staff confirms the recipient and document scope before release.

14. Do not add a separate all-staff journey dashboard.
Resolution: Communication configuration and delivery insight live in Admin settings. Service recovery remains an ordinary owned task.

15. Surface room pressure without building a separate room product.
Resolution: Staff opens minimal room controls on demand, with a prompt when two of three rooms are occupied. PIMS events are preferred, with staff override as fallback.

16. Keep the product ready for Cornerstone, AVImark, and other PIMS integrations.
Resolution: PIMS provider stays a tenant-configured adapter boundary rather than provider-specific core logic.

17. Treat this as a real product, not a demo.
Resolution: Real email and SMS use gated delivery modes, consent, quiet hours, retries, and audit. Mock data remains replaceable by tenant-scoped production adapters. This rule is also in the scoped component `AGENTS.md`.

18. Use tenant-specific branding and a Tri-City tenant domain.
Resolution: The current plan uses `tricityvet.eepish.com` while keeping name, history, sender identity, domain, and PIMS provider configurable.

19. Research reminder timing and messaging policy.
Resolution: The plan uses an immediate confirmation, a 48-hour email, a guaranteed 24-hour SMS for consented clients, quiet hours, opt-out handling, and cancellation after appointment state changes.

20. Make the audience boundary explicit.
Resolution: Customer-facing UI shows reassuring next steps and never internal task language; employee-facing UI contains private operational tasks and notes.

21. Put communication automation primarily in Admin settings.
Resolution: Admin owns outreach, notification settings, templates, delivery modes, integration status, reporting, and audit. The plan now includes a light Admin settings mockup.

22. Keep staff, veterinarian, and admin as distinct roles.
Resolution: Staff means front desk or cashier with minimal operational work. Veterinarians own clinical callbacks and discharge approval. Admin means hospital owner or manager.

23. Prevent staff from deleting veterinarian work.
Resolution: Staff cannot delete or archive veterinarian-owned clinical tasks. Both UI actions and server workflows enforce the boundary.

24. Keep the product UI terse and self-explanatory.
Resolution: Default screens show current actionable state only. Dense controls appear on demand so routine work does not require a training video.

25. Preserve these corrections outside browser chat.
Resolution: The plan carries a visible scope ledger and small surface mockups. Durable role and UX rules live in the narrow scoped component and API `AGENTS.md` files.

26. Keep the customer portal focused on the current need.
Resolution: Chat appears first. Visit feedback and pet checks appear only when due, never as permanent dashboard cards.

27. Remove manual refresh as the normal staff workflow.
Resolution: Operational state updates automatically when the data source supports it. Room controls remain an on-demand exception surface.

28. Make the official Tri-City site available at `tricityvet.eepish.com`.
Resolution: Pending. Live verification found a healthy Render origin with the older Central Vet experience, while the Tri-City hostname falls through an old Vercel wildcard and fails TLS. Release requires the approved Tri-City build, database state, Render custom domain, Cloudflare DNS override, TLS, and browser proof.

29. Never confuse the Lavish artifact with the implemented product.
Resolution: Applied. The plan now starts with live state, release target, explicit plan-only labeling, and deployment status.

30. Disclose all UI before implementation.
Resolution: Applied. The Screens section shows the only four material surfaces: customer home, staff task board, veterinarian task board, and Admin settings. Each card lists included and excluded behavior.

31. Preserve and apply every annotation.
Resolution: Applied to the skill. Exact substantive prompt text must be stored with affected surfaces and applied, pending, or declined status. Generic `updated` replies are prohibited.

32. Withdraw approval for the prior UI changes.
Resolution: Applied. The artifact is reopened and defaults its UI release gate to `Needs changes before implementation`. No product build or deployment proceeds from the prior approval.

## Control and approval messages

- `can you check`
- `Ok check`
- `ok plan looks good also`

These messages controlled the review loop or approved the plan; they did not add product requirements.

## July 17 deployment and review instruction

> Just make sure the skill is very good, and also, you have access to my render CLI and stuff, right? Could you please, for some reason, I used to deploy it so I could see it and do all the changes I wanted? Make sure this is lavish. When I use it again, it's actually going to be good. It's not going to fuck up your list time, so make sure lavish is perfect. When I do the annotations, make sure it includes the annotations, and make sure that's going to be perfect. Another thing is I want you to Deploy it so I can see it on render and stuff. Add this stuff to git and stuff, by the way, but it just picks everything.

33. Preserve every returned annotation even if the agent turn is interrupted.
Resolution: Applied to the shared skill. Every poll now uses a local receipt wrapper that saves the complete returned batch before printing it, then requires an exact prompt-count reconciliation against this decision log.

34. Deploy the current complete implementation to Render so it can be inspected and changed.
Resolution: Applied. Vet commit `de479b2` is live at `https://vetagent-internal.onrender.com`. Render, tenant, and authorization API proof passed. Visual Chrome proof remains pending until the locked Mac can accept Chrome's remote-debugging prompt. This is an inspection preview, not final UI approval.

35. Add the intended complete change set to git.
Resolution: Applied. The Vet product and review files are one change set. The shared Lavish skill is committed separately in `agent-scripts` so unrelated changes in that repository are not swept in.
