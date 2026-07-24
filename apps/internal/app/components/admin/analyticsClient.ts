import type {
  AnalyticsRangeDays,
  ClientAnalyticsSnapshot
} from "@central-vet/db";
import { readJson } from "../../lib/apiClient";
import { sessionReadHeaders, taskBoardActorQuery } from "../taskBoardClient";
import type { TaskBoardSession } from "../taskBoardTypes";

export async function readAdminAnalytics(
  session: TaskBoardSession,
  rangeDays: AnalyticsRangeDays,
  signal?: AbortSignal
) {
  const actorQuery = taskBoardActorQuery(session);
  return readJson<ClientAnalyticsSnapshot>(
    await fetch(`/api/analytics?${actorQuery}&days=${rangeDays}`, {
      cache: "no-store",
      headers: sessionReadHeaders(session),
      signal
    }),
    "Analytics are unavailable."
  );
}
