# Vet Product Context

## Language

**Staff**:
Front-desk and cashier team members handling arrivals, payments, and operational tasks.
_Avoid_: Clinic owner, veterinarian

**Veterinarian**:
Clinical team member responsible for medical decisions and patient care.
_Avoid_: Front desk, admin

**Admin**:
Hospital owner or manager responsible for clinic-wide settings, automation, and reporting.
_Avoid_: Generic staff member

**Client request**:
A non-arrival client ask that becomes clinic staff work.
_Avoid_: Request intake

**Arrival intake**:
A client check-in for today's visit, with identity, visit reason, and concern-specific questions. It may match an appointment and place the patient in the arrival flow.
_Avoid_: Check-in request, seating

**Customer account**:
An optional pet-owner identity used to prefill public flows and access the portal.
_Avoid_: Required check-in login

**Account claim**:
A customer account activation that proves control of a phone number or email already associated with a clinic client record.
_Avoid_: Staff-created customer password

**PIMS**:
The clinic system of record for clients, patients, appointments, visits, and record write-backs.
_Avoid_: Lab system

**Lab integration**:
A diagnostic lab connection for orders, results, and lab report status.
_Avoid_: PIMS

**Matched arrival**:
An arrival intake that confidently links to one current clinic appointment and patient record using the customer account or the contact number on the clinic record, allowing automatic check-in actions.
_Avoid_: Pending staff review for matched check-in

**Arrival identity**:
The customer, patient, and verified clinic contact used to match an arrival before collecting visit questions.
_Avoid_: Free-form check-in identity

**Arrival exception**:
An arrival that cannot be safely matched to one current appointment and needs front-desk help before full intake.
_Avoid_: Unmatched full intake

**Visit reason**:
The primary reason for today's matched appointment, defaulted from the appointment when known and confirmed by the customer during arrival.
_Avoid_: Main concern

**Arrival questionnaire**:
The concern-specific questions collected after arrival identity is matched, using a fixed clinic form whose questions and options can be edited by admin.
_Avoid_: Pre-match intake form

**Check-in room**:
A clinic-controlled room that can receive matched arrivals when room assignment is enabled.
_Avoid_: Seating

**Room assignment**:
The placement of a matched arrival into an available check-in room, with the clinic team able to override room state.
_Avoid_: Staff-confirmed recommendation

**Room turnover**:
The process of moving a room from occupied to cleaning to open after a visit is done, preferably from a PIMS signal with clinic-team fallback.
_Avoid_: Manual-only room release

**Visit stage event**:
A tenant-scoped timestamp for checked in, roomed, care started, care complete, or checkout complete.
It can come from the current app or a future PIMS adapter and supports real wait-time analytics.
_Avoid_: Estimated journey duration

**Returning client**:
A client with more than one completed visit.
Future appointments are reported separately as rebooked business.
_Avoid_: Counting reminders or portal logins as repeat business

**Recovery follow-up**:
The post-visit pet health email and, only when unanswered by the configured deadline, the Admin call queue.
_Avoid_: Automatic medical advice

**Design-partner profile**:
Tenant-configured clinic branding, history, sender identity, domain, messaging defaults, and PIMS provider.
The current profile is Tri-City; it is not a product-wide hardcode.
_Avoid_: Global clinic branding

**Hospital tenant**:
One clinic identity with its own domains, branding, settings, accounts, and data.
Central Veterinary Hospital and Tri-City Veterinary Hospital are distinct hospital tenants.
_Avoid_: Domain alias between hospitals, shared hospital branding

**PIMS-ready boundary**:
A real-product integration seam for Cornerstone, AVImark, and other clinic systems, with staff fallback until a provider adapter is connected.
_Avoid_: Demo-only workflow, provider-specific core logic
