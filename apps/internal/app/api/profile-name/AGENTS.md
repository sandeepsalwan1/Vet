# AGENTS.md

Profile-name route modules.

## Rules

- `route.ts` authenticates actor credentials and maps module results to HTTP.
- `_profileNameRequest.ts` owns doctor-name normalization, veterinarian profile update, and actor-reference rename side effects.
- Veterinarian names should use `Dr.` normalization from `veterinarianProfile.ts`.
- Return updated profile payload for veterinarian sessions so browser settings stay in sync.
- Do not log passcodes or contact details.
