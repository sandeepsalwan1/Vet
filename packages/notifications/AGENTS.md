# Notification Boundary

- Keep content rendering, delivery planning, and send side effects separate.
- Delivery planning owns mode, channel, recipient, timezone, and opt-in policy.
- The send pipeline owns idempotency and attempt lifecycle before transport.
- Disabled, test, and production modes remain explicit; production delivery requires approved configuration.
- Do not log recipients, passcodes, API keys, or transport credentials.
- Export the package interface through `src/index.ts`; do not import app routes or UI.
