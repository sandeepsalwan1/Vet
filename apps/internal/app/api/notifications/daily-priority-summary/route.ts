import { dbError } from "../../_apiResponse";
import { dailyPrioritySummaryResponse } from "../_notificationRequest";

export async function GET(request: Request) {
  try {
    return await dailyPrioritySummaryResponse(request);
  } catch (error) {
    return dbError(error, { route: "notifications.dailyPrioritySummary" });
  }
}
