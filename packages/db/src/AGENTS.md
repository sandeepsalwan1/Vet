# AGENTS.md

Postgres implementation modules.

## Rules

- Use parameterized `postgres` template queries only.
- Every tenant-owned query takes or resolves `clinicId`.
- Row-to-contract mapping belongs in `*Rows.ts`.
- Clinic row projection lives in `clinicRows.ts`; `clinics.ts` owns default-clinic and hostname resolution.
- Agent decision row projection lives in `agentDecisionRows.ts`; `agentDecisions.ts` owns writes/reads.
- Agent memory row projection lives in `agentMemoryRows.ts`; `agentMemory.ts` owns writes/search/correction.
- Arrival intake row projection lives in `arrivalIntakeRows.ts`; room setup/turnover lives in `arrivalRooms.ts`; query/matched-arrival orchestration stays in `arrivalIntake.ts`.
- `settings.ts` merges legacy unscoped recipient profile rows with clinic-scoped rows; scoped rows win per profile id.
- Keep JSON coercion/redaction in `agentJson.ts`.
- Keep status transitions in `taskTransitions.ts`, not route code.
- Keep migrations append-only; do not patch historical SQL.
