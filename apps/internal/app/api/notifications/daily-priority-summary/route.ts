import { withDbError } from "../../_apiResponse";
import { dailyPrioritySummaryResponse } from "../_notificationRequest";

export const GET = withDbError(
  "notifications.dailyPrioritySummary",
  dailyPrioritySummaryResponse
);
