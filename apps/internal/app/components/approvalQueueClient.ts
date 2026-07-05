import { readJson } from "../lib/apiClient";
import { sessionReadHeaders, taskBoardActorQuery } from "./taskBoardClient";
import type { TaskBoardSession } from "./taskBoardTypes";

export type ApprovalQueueItem = {
  id: string;
  approvalType: string;
  status: string;
  title: string;
  summary: string;
  createdAt: string;
};

export async function readApprovalQueue(session: TaskBoardSession) {
  const actorQuery = taskBoardActorQuery(session, false);
  const data = await readJson<{ approvals?: ApprovalQueueItem[] }>(
    await fetch(`/api/approvals?${actorQuery}`, {
      cache: "no-store",
      headers: sessionReadHeaders(session)
    })
  );
  return data.approvals ?? [];
}

export async function decideApprovalQueueItem(
  actor: TaskBoardSession,
  id: string,
  status: "approved" | "rejected"
) {
  return readJson(
    await fetch(`/api/approvals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor, decision: { status } })
    })
  );
}
