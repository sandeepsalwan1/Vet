import { withDbError } from "../../_apiResponse";
import { operatorUsageAlertResponse } from "../_notificationRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError(
  "notifications.operator_usage",
  operatorUsageAlertResponse
);
