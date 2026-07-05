# AGENTS.md

Shared workspace packages.

## Rules

- Package interfaces should be deep: small caller surface, behavior behind it.
- Add package seams only when at least two callers need them.
- Keep UI code in `apps/internal`, not shared packages.
- Keep package exports explicit through `src/index.ts`.
- Each package owns its own `typecheck` script.
- Prefer package-local helpers over cross-package reach-through imports.
