import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import { jsonInput, redactedAgentObject } from "./agentJson";
import {
  memoryColumns,
  normalizeMemory,
  type AgentMemoryRow
} from "./agentMemoryRows";
export type { AgentMemory } from "./agentMemoryRows";

function vectorLiteral(values: number[]) {
  return `[${values.map((value) => Number.isFinite(value) ? Number(value).toFixed(8) : "0").join(",")}]`;
}

export async function createAgentMemory(input: {
  clinicId?: string | null;
  subjectType: string;
  subjectId?: string | null;
  memoryType?: string;
  fact: string;
  confidence?: number;
  sourceRunId?: string | null;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const embedding = input.embedding?.length ? vectorLiteral(input.embedding) : null;
  const rows = await sql<AgentMemoryRow[]>`
    insert into agent_memories (
      clinic_id,
      subject_type,
      subject_id,
      memory_type,
      fact,
      confidence,
      source_run_id,
      metadata,
      embedding
    )
    values (
      ${clinicId},
      ${input.subjectType},
      ${input.subjectId ?? null},
      ${input.memoryType ?? "preference"},
      ${input.fact},
      ${input.confidence ?? 0.7},
      ${input.sourceRunId ?? null},
      ${sql.json(jsonInput(redactedAgentObject(input.metadata)))},
      ${embedding ? sql.unsafe(`'${embedding}'::vector`) : null}
    )
    returning ${sql.unsafe(memoryColumns)}
  `;
  return normalizeMemory(rows[0]);
}

export async function listAgentMemories(options: {
  clinicId?: string | null;
  subjectType?: string | null;
  subjectId?: string | null;
  memoryType?: string | null;
  includeDeleted?: boolean;
  limit?: number;
} = {}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const rows = await sql<AgentMemoryRow[]>`
    select ${sql.unsafe(memoryColumns)}
    from agent_memories
    where clinic_id = ${clinicId}
      and (${options.subjectType ?? null}::text is null or subject_type = ${options.subjectType ?? null})
      and (${options.subjectId ?? null}::text is null or subject_id = ${options.subjectId ?? null})
      and (${options.memoryType ?? null}::text is null or memory_type = ${options.memoryType ?? null})
      and (${Boolean(options.includeDeleted)} or deleted_at is null)
    order by created_at desc
    limit ${limit}
  `;
  return rows.map(normalizeMemory);
}

export async function searchAgentMemories(options: {
  clinicId?: string | null;
  query: string;
  embedding?: number[] | null;
  subjectType?: string | null;
  subjectId?: string | null;
  limit?: number;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options.clinicId);
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const query = options.query.trim();
  if (!query) return [];

  if (options.embedding?.length) {
    const embedding = vectorLiteral(options.embedding);
    const rows = await sql<AgentMemoryRow[]>`
      select
        ${sql.unsafe(memoryColumns)},
        (
          0.7 * (1 - (embedding <=> ${sql.unsafe(`'${embedding}'::vector`)})) +
          0.3 * ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query}))
        ) as score
      from agent_memories
      where clinic_id = ${clinicId}
        and deleted_at is null
        and (${options.subjectType ?? null}::text is null or subject_type = ${options.subjectType ?? null})
        and (${options.subjectId ?? null}::text is null or subject_id = ${options.subjectId ?? null})
        and (
          search_vector @@ websearch_to_tsquery('english', ${query})
          or embedding is not null
        )
      order by score desc, created_at desc
      limit ${limit}
    `;
    return rows.map(normalizeMemory);
  }

  const rows = await sql<AgentMemoryRow[]>`
    select
      ${sql.unsafe(memoryColumns)},
      ts_rank_cd(search_vector, websearch_to_tsquery('english', ${query})) as score
    from agent_memories
    where clinic_id = ${clinicId}
      and deleted_at is null
      and (${options.subjectType ?? null}::text is null or subject_type = ${options.subjectType ?? null})
      and (${options.subjectId ?? null}::text is null or subject_id = ${options.subjectId ?? null})
      and search_vector @@ websearch_to_tsquery('english', ${query})
    order by score desc, created_at desc
    limit ${limit}
  `;
  return rows.map(normalizeMemory);
}

export async function deleteAgentMemory(id: string, options?: {
  clinicId?: string | null;
  correctionNote?: string | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<AgentMemoryRow[]>`
    update agent_memories
    set
      deleted_at = coalesce(deleted_at, now()),
      correction_note = coalesce(${options?.correctionNote ?? null}, correction_note),
      updated_at = now()
    where id = ${id}
      and clinic_id = ${clinicId}
    returning ${sql.unsafe(memoryColumns)}
  `;
  return rows[0] ? normalizeMemory(rows[0]) : null;
}

export async function correctAgentMemory(id: string, input: {
  clinicId?: string | null;
  fact: string;
  correctionNote?: string | null;
  confidence?: number;
  metadata?: Record<string, unknown>;
  embedding?: number[] | null;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(input.clinicId);
  const existingRows = await sql<AgentMemoryRow[]>`
    select ${sql.unsafe(memoryColumns)}
    from agent_memories
    where id = ${id}
      and clinic_id = ${clinicId}
      and deleted_at is null
    limit 1
  `;
  const existing = existingRows[0];
  if (!existing) return null;
  const replacement = await createAgentMemory({
    clinicId,
    subjectType: existing.subject_type,
    subjectId: existing.subject_id,
    memoryType: existing.memory_type,
    fact: input.fact,
    confidence: input.confidence ?? Number(existing.confidence),
    sourceRunId: existing.source_run_id,
    metadata: { ...existing.metadata, ...(input.metadata ?? {}), correctedFrom: id },
    embedding: input.embedding
  });
  await sql`
    update agent_memories
    set
      deleted_at = now(),
      superseded_by_id = ${replacement.id},
      correction_note = ${input.correctionNote ?? null},
      updated_at = now()
    where id = ${id}
      and clinic_id = ${clinicId}
  `;
  return replacement;
}
