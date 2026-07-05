# AGENTS.md

Arrival intake route modules.

## Rules

- `route.ts` delegates GET/POST/PATCH to `_arrivalIntakeRequest.ts`.
- `_arrivalIntakeRequest.ts` owns public/staff auth, request validation, public match/submit actions, arrival exceptions, room updates, checkout, arrival settings mutations, and HTTP response mapping.
- Public match must create an Arrival exception when no safe single appointment match exists.
- Staff desk mutations require authenticated actors; arrival settings require Admin.
- Keep questionnaire shape fixed and validated at the route module seam.
