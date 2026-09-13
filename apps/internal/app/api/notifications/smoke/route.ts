import { withDbError } from "../../_apiResponse";
import { smokeNotificationResponse } from "../_notificationRequest";

export const POST = withDbError(
  "notifications.smoke",
  smokeNotificationResponse
);
