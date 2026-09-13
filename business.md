# Business

Internal product and business direction.
This file is not part of the hospital-facing product.

## Private Product Health

### What people do

Show these only in a private platform-operator view:

- Daily active users
- Return rate in week 2 and later
- Sessions per month

Measure real authenticated use.
Exclude demo accounts, tests, automation, health checks, and page refreshes without a meaningful action.
Allow comparison by role, hospital, and time period without exposing patient, client, message, or medical content.
Show `Collecting` when the available data cannot support an honest result.

Metric definitions:

- **Daily active users:** distinct people who complete at least one meaningful product action that day.
- **Return rate in week 2 and later:** percentage of new users who complete another meaningful action between days 8 and 30 after their first action.
- **Sessions per month:** authenticated sessions during the month, with a new session beginning after 30 minutes of inactivity.

### Access boundary

- A dedicated platform-operator role is the only role allowed to open the view or query its data.
- Start with one explicitly configured platform-operator identity.
- Hospital Admin remains a hospital owner or manager and never grants platform-operator access.
- Enforce authorization on the server for both the page and every data request.
- Do not rely on a hidden navigation item, an unlisted URL, or browser-only checks.
- Do not include this view in hospital navigation, reports, exports, or agent answers.
- Keep hospital data tenant-isolated.
- Record platform-operator access in an audit log.
- Prove with an authorization test that a hospital Admin is denied before any private analytics query runs.

### Low-return notification

- Keep the email alert off by default.
- Allow the platform operator to enable or disable it from the private view.
- Alert when the week 2+ return rate is below 15%.
- Do not alert until at least five users have a complete 30-day return window.
- Send once when the rate enters the low state.
- While it remains low, send no more than one reminder every 30 days.
- Keep the recipient in secure deployment configuration rather than source or hospital settings.

Status: implemented locally.
The private view and email delivery require deployment configuration before use.
