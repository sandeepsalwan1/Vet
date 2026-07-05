import {
  getAgentRunWithTimeline,
  listAgentDecisions,
  type AgentDecisionStatus
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { noStoreHeaders } from "../_apiResponse";
import { requireManagerFromQuery } from "../_shared";

const decisionStatuses = new Set<AgentDecisionStatus>([
  "proposed",
  "confirmed",
  "completed",
  "blocked",
  "skipped",
  "failed"
]);

function statusParam(value: string | null) {
  return value && decisionStatuses.has(value as AgentDecisionStatus)
    ? value as AgentDecisionStatus
    : null;
}

function limitParam(value: string | null) {
  const limit = Number(value || 50);
  return Number.isFinite(limit) ? limit : 50;
}

export async function agentDecisionListResponse(request: Request) {
  const auth = await requireManagerFromQuery(request);
  if ("response" in auth) return auth.response;
  const url = auth.url;
  const decisions = await listAgentDecisions({
    clinicId: auth.clinic.clinicId,
    runId: url.searchParams.get("runId"),
    decisionKind: url.searchParams.get("kind"),
    status: statusParam(url.searchParams.get("status")),
    limit: limitParam(url.searchParams.get("limit"))
  });
  return NextResponse.json({ ok: true, decisions }, { headers: noStoreHeaders });
}

export async function agentRunTimelineResponse(args: {
  request: Request;
  id: string;
}) {
  const auth = await requireManagerFromQuery(args.request);
  if ("response" in auth) return auth.response;
  const detail = await getAgentRunWithTimeline(args.id, { clinicId: auth.clinic.clinicId });
  if (!detail) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  return NextResponse.json({ ok: true, ...detail }, { headers: noStoreHeaders });
}
