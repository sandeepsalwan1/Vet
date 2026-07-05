import { dbError } from "../../_apiResponse";
import { smokeNotificationResponse } from "../_notificationRequest";

export async function POST(request: Request) {
  try {
    return await smokeNotificationResponse(request);
  } catch (error) {
    return dbError(error, { route: "notifications.smoke" });
  }
}
