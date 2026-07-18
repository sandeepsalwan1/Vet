# Client Request Boundary

- The `/request` UI stays in `apps/internal`; this package owns request handling behind its root interface.
- Keep validation, rate-limit/duplicate guards, structured logging, and task creation inside the package.
- Hash client and request identifiers before guard logs or persistence.
- Preserve the `fieldErrors` contract consumed by the request form.
- Do not import app routes or UI into this package.
