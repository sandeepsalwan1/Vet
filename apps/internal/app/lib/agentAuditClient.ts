// Browser adapter for staff agent audit and memory routes.

import { readJson } from "./apiClient";
import {
  browserActorBody,
  browserActorReadHeaders,
  browserActorReadQuery,
  type BrowserActorSession
} from "./browserActor";

export type AgentDecisionRow = {
  id: string;
  runId: string | null;
  agent: string;
  capability: string;
  decisionKind: string;
  status: string;
  action: string;
  resultSummary: string | null;
  createdAt: string;
};

export type AgentMemoryRow = {
  id: string;
  subjectType: string;
  subjectId: string | null;
  memoryType: string;
  fact: string;
  confidence: number;
  createdAt: string;
};

export async function readAgentAudit(session: BrowserActorSession, limit = 6) {
  const query = browserActorReadQuery(session, { limit });
  const headers = browserActorReadHeaders(session);
  const [decisionData, memoryData] = await Promise.all([
    readJson<{ decisions?: AgentDecisionRow[] }>(
      await fetch(`/api/agent/decisions?${query}`, { cache: "no-store", headers }),
      "Decision audit failed."
    ),
    readJson<{ memories?: AgentMemoryRow[] }>(
      await fetch(`/api/agent/memory?${query}`, { cache: "no-store", headers }),
      "Memory audit failed."
    )
  ]);
  return {
    decisions: decisionData.decisions ?? [],
    memories: memoryData.memories ?? []
  };
}

export async function writeAgentMemory(
  session: BrowserActorSession,
  args: {
    method: "POST" | "PATCH" | "DELETE";
    id?: string;
    subjectType?: string;
    fact?: string;
    memoryType?: string;
    correctionNote?: string;
  }
) {
  const body = args.method === "DELETE"
    ? {
        actor: browserActorBody(session),
        id: args.id,
        correctionNote: args.correctionNote ?? "Deleted from staff agent console."
      }
    : {
        actor: browserActorBody(session),
        ...(args.id ? { id: args.id, correctionNote: args.correctionNote ?? "Corrected from staff agent console." } : {}),
        subjectType: args.subjectType,
        fact: args.fact,
        memoryType: args.memoryType ?? "preference"
      };

  return readJson<{ memory?: AgentMemoryRow }>(
    await fetch("/api/agent/memory", {
      method: args.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }),
    "Memory update failed."
  );
}
