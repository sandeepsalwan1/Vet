export type AgentMemory = {
  id: string;
  clinicId: string;
  subjectType: string;
  subjectId: string | null;
  memoryType: string;
  fact: string;
  confidence: number;
  sourceRunId: string | null;
  metadata: Record<string, unknown>;
  deletedAt: string | null;
  supersededById: string | null;
  correctionNote: string | null;
  createdAt: string;
  updatedAt: string;
  score?: number;
};

export type AgentMemoryRow = {
  id: string;
  clinic_id: string;
  subject_type: string;
  subject_id: string | null;
  memory_type: string;
  fact: string;
  confidence: number;
  source_run_id: string | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  superseded_by_id: string | null;
  correction_note: string | null;
  created_at: string;
  updated_at: string;
  score?: number;
};

export const memoryColumns = `
  id,
  clinic_id,
  subject_type,
  subject_id,
  memory_type,
  fact,
  confidence,
  source_run_id,
  metadata,
  deleted_at,
  superseded_by_id,
  correction_note,
  created_at,
  updated_at
`;

export function normalizeMemory(row: AgentMemoryRow): AgentMemory {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    subjectType: row.subject_type,
    subjectId: row.subject_id,
    memoryType: row.memory_type,
    fact: row.fact,
    confidence: Number(row.confidence),
    sourceRunId: row.source_run_id,
    metadata: row.metadata ?? {},
    deletedAt: row.deleted_at,
    supersededById: row.superseded_by_id,
    correctionNote: row.correction_note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    score: typeof row.score === "number" ? row.score : undefined
  };
}
