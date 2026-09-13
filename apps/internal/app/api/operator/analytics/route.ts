import { withDbError } from "../../_apiResponse";
import { platformOperatorAnalyticsResponse } from "../_operatorRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError(
  "operator.analytics.get",
  platformOperatorAnalyticsResponse
);
