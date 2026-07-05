# AGENTS.md

Settings route modules.

## Rules

- `route.ts` authenticates, checks role access, and maps module results to HTTP.
- `_settingsRequest.ts` owns notification setting projection, veterinarian profile mutation, name normalization, and actor-reference rename side effects.
- Only Admin can change end-of-day alerts, create veterinarian profiles, or deactivate profiles.
- Veterinarians can only edit their own profile.
- Do not log passcodes, live recipient addresses, or transport credentials.
