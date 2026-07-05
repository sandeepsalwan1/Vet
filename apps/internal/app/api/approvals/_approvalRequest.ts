import {
  createApproval,
  decideApproval,
  listApprovals,
  type Actor,
  type ClinicContext
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canManage } from "../../lib/taskWorkflow";
import { noStoreHeaders } from "../_apiResponse";
import {
  actorSchema,
  authenticateActor,
  requireManagerFromQuery,
  resolveClinicFromRequest
} from "../_shared";

const approvalSchema = z.object({
  runId: z.string().uuid().optional().nullable(),
  taskId: z.string().uuid().optional().nullable(),
  approvalType: z.string().trim().min(2).max(80),
  title: z.string().trim().min(2).max(160),
  summary: z.string().trim().min(2).max(2000),
  requestedAction: z.record(z.string(), z.unknown()).optional()
});

const decisionSchema = z.object({
  status: z.enum(["approved", "rejected"]),
  note: z.string().trim().max(1000).optional().nullable()
});

type ApprovalRequestResult =
  | { ok: true; approval: unknown; status?: number }
  | { ok: false; error: string; status: number }
  | { response: NextResponse };

async function approvalListPayload(clinicId: string, status: string) {
  const approvals = await listApprovals({ clinicId, status });
  return { ok: true, approvals };
}

async function requireManagerActor(
  request: Request,
  body: Record<string, unknown>,
  clinic: ClinicContext,
  invalidActorError: { error: string; status: number }
): Promise<{ actor: Actor } | { ok: false; error: string; status: number } | { response: NextResponse }> {
  const actorResult = actorSchema.safeParse(body.actor);
  if (!actorResult.success) return { ok: false, ...invalidActorError };

  const auth = await authenticateActor(actorResult.data, request, clinic);
  if ("response" in auth) return { response: auth.response };
  if (!canManage(auth.actor.role)) {
    return { ok: false, error: "Manager access required.", status: 403 };
  }
  return { actor: auth.actor };
}

async function createApprovalFromBody(
  request: Request,
  body: Record<string, unknown>,
  clinic: ClinicContext
): Promise<ApprovalRequestResult> {
  const manager = await requireManagerActor(
    request,
    body,
    clinic,
    { error: "Actor credentials are required.", status: 403 }
  );
  if ("response" in manager || "ok" in manager) return manager;

  const parsed = approvalSchema.safeParse(body.approval);
  if (!parsed.success) {
    return { ok: false, error: "Invalid approval request.", status: 400 };
  }

  return {
    ok: true,
    status: 201,
    approval: await createApproval({
      ...parsed.data,
      clinicId: clinic.clinicId
    })
  };
}

async function decideApprovalFromBody(
  request: Request,
  body: Record<string, unknown>,
  clinic: ClinicContext,
  approvalId: string
): Promise<ApprovalRequestResult> {
  const decisionResult = decisionSchema.safeParse(body.decision ?? body);
  const manager = await requireManagerActor(
    request,
    body,
    clinic,
    { error: "Invalid approval decision.", status: 400 }
  );
  if (!decisionResult.success) {
    return { ok: false, error: "Invalid approval decision.", status: 400 };
  }
  if ("ok" in manager) return manager;
  if ("response" in manager) return manager;

  const approval = await decideApproval(approvalId, {
    clinicId: clinic.clinicId,
    status: decisionResult.data.status,
    actor: manager.actor,
    note: decisionResult.data.note
  });
  return approval
    ? { ok: true, approval }
    : { ok: false, error: "Approval not found.", status: 404 };
}

function approvalMutationResponse(result: ApprovalRequestResult) {
  if ("response" in result) return result.response;
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json(
    { ok: true, approval: result.approval },
    { headers: noStoreHeaders, status: result.status }
  );
}

export async function approvalListResponse(request: Request) {
  const auth = await requireManagerFromQuery(request);
  if ("response" in auth) return auth.response;

  const status = auth.url.searchParams.get("status") || "pending";
  return NextResponse.json(
    await approvalListPayload(auth.clinic.clinicId, status),
    { headers: noStoreHeaders }
  );
}

export async function approvalCreateResponse(request: Request) {
  const body = await request.json().catch(() => ({}));
  const clinic = await resolveClinicFromRequest(request);
  return approvalMutationResponse(await createApprovalFromBody(request, body, clinic));
}

export async function approvalDecisionResponse(args: {
  request: Request;
  id: string;
}) {
  const body = await args.request.json().catch(() => ({}));
  const clinic = await resolveClinicFromRequest(args.request);
  return approvalMutationResponse(await decideApprovalFromBody(args.request, body, clinic, args.id));
}
