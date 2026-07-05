# AGENTS.md

Notification package.

## Shape

- `notificationContent.ts`: HTML/text rendering.
- `notificationDelivery.ts`: mode/channel/recipient planning.
- `notificationSend.ts`: idempotent send pipeline and transport.
- `index.ts`: package interface.

## Rules

- Keep content, delivery planning, and send side effects separate.
- Honor profile opt-ins and test/disabled modes.
- Use idempotency keys for repeatable notifications.
- Do not log recipient secrets or transport credentials.
