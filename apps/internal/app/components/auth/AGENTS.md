# AGENTS.md

Auth UI modules.

## Rules

- Customer auth proves an existing clinic contact or creates a local customer account.
- Staff auth uses configured demo/test accounts and one-time passcodes from account-store helpers.
- Keep password/passcode display behavior in `AuthPasswordInput.tsx`.
- Keep one-time/reset code uppercase formatting in `AuthCodeInput.tsx`.
- Do not hard-code live credentials.
- Keep copy short; login errors should not reveal whether a live secret exists.
