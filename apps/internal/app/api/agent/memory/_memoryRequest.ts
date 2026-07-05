import {
  correctAgentMemory,
  createAgentMemory,
  deleteAgentMemory,
  listAgentMemories,
  searchAgentMemories,
  type Actor
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { noStoreHeaders } from "../../_apiResponse";
import {
  requireManagerFromBody,
  requireManagerFromQuery
} from "../../_shared";

const memoryBodySchema = z.object({
  id: z.string().uuid().optional(),
  subjectType: z.string().trim().min(1).max(80).optional(),
  subjectId: z.string().trim().max(120).optional().nullable(),
  memoryType: z.string().trim().max(80).optional(),
  fact: z.string().trim().min(1).max(1000).optional(),
  confidence: z.number().min(0).max(1).optional(),
  correctionNote: z.string().trim().max(500).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional()
}).passthrough();

type MemoryBody = z.infer<typeof memoryBodySchema>;
type MemoryActionResult =
  | { ok: true; memory: unknown }
  | { ok: false; error: string; status: number };

function limitParam(value: string | null) {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? limit : 50;
}

function parseMemoryBody(body: Record<string, unknown>): MemoryBody | null {
  const parsed = memoryBodySchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

function actorMetadata(actor: Actor) {
  return {
    name: actor.name,
    role: actor.role,
    profileId: actor.profileId ?? null
  };
}

async function memoryListPayload(url: URL, clinicId: string) {
  const query = url.searchParams.get("q")?.trim();
  const options = {
    clinicId,
    subjectType: url.searchParams.get("subjectType"),
    subjectId: url.searchParams.get("subjectId"),
    memoryType: url.searchParams.get("memoryType"),
    limit: limitParam(url.searchParams.get("limit"))
  };
  const memories = query
    ? await searchAgentMemories({ ...options, query })
    : await listAgentMemories(options);
  return { ok: true, memories };
}

async function createMemoryFromBody(
  body: Record<string, unknown>,
  actor: Actor,
  clinicId: string
): Promise<MemoryActionResult> {
  const memoryBody = parseMemoryBody(body);
  if (!memoryBody?.subjectType || !memoryBody.fact) {
    return { ok: false, error: "subjectType and fact are required.", status: 400 };
  }

  return {
    ok: true,
    memory: await createAgentMemory({
      clinicId,
      subjectType: memoryBody.subjectType,
      subjectId: memoryBody.subjectId,
      memoryType: memoryBody.memoryType,
      fact: memoryBody.fact,
      confidence: memoryBody.confidence,
      metadata: {
        ...(memoryBody.metadata ?? {}),
        actor: actorMetadata(actor)
      }
    })
  };
}

async function correctMemoryFromBody(
  body: Record<string, unknown>,
  actor: Actor,
  clinicId: string
): Promise<MemoryActionResult> {
  const memoryBody = parseMemoryBody(body);
  if (!memoryBody?.id || !memoryBody.fact) {
    return { ok: false, error: "id and fact are required.", status: 400 };
  }

  const memory = await correctAgentMemory(memoryBody.id, {
    clinicId,
    fact: memoryBody.fact,
    confidence: memoryBody.confidence,
    correctionNote: memoryBody.correctionNote,
    metadata: {
      ...(memoryBody.metadata ?? {}),
      correctedBy: actorMetadata(actor)
    }
  });
  return memory
    ? { ok: true, memory }
    : { ok: false, error: "Memory not found.", status: 404 };
}

async function deleteMemoryFromBody(
  body: Record<string, unknown>,
  clinicId: string
): Promise<MemoryActionResult> {
  const memoryBody = parseMemoryBody(body);
  if (!memoryBody?.id) {
    return { ok: false, error: "id is required.", status: 400 };
  }

  const memory = await deleteAgentMemory(memoryBody.id, {
    clinicId,
    correctionNote: memoryBody.correctionNote
  });
  return memory
    ? { ok: true, memory }
    : { ok: false, error: "Memory not found.", status: 404 };
}

function memoryResponse(result: MemoryActionResult) {
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, memory: result.memory }, { headers: noStoreHeaders });
}

export async function memoryListResponse(request: Request) {
  const auth = await requireManagerFromQuery(request);
  if ("response" in auth) return auth.response;
  return NextResponse.json(
    await memoryListPayload(auth.url, auth.clinic.clinicId),
    { headers: noStoreHeaders }
  );
}

export async function memoryCreateResponse(request: Request) {
  const auth = await requireManagerFromBody(request);
  if ("response" in auth) return auth.response;
  return memoryResponse(await createMemoryFromBody(auth.body, auth.actor, auth.clinic.clinicId));
}

export async function memoryCorrectionResponse(request: Request) {
  const auth = await requireManagerFromBody(request);
  if ("response" in auth) return auth.response;
  return memoryResponse(await correctMemoryFromBody(auth.body, auth.actor, auth.clinic.clinicId));
}

export async function memoryDeleteResponse(request: Request) {
  const auth = await requireManagerFromBody(request);
  if ("response" in auth) return auth.response;
  return memoryResponse(await deleteMemoryFromBody(auth.body, auth.clinic.clinicId));
}
