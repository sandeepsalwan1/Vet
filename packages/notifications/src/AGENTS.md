# AGENTS.md

Notification implementation modules.

## Rules

- Content rendering lives in `notificationContent.ts`.
- Recipient/mode/channel planning lives in `notificationDelivery.ts`.
- Attempt lifecycle and transport live in `notificationSend.ts`.
- Package interface stays in `index.ts`.
- Disabled/test/production modes must remain explicit.
- Do not log recipient secrets, API keys, or transport credentials.
