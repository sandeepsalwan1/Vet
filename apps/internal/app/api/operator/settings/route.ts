import { withDbError } from "../../_apiResponse";
import { updatePlatformOperatorSettingsResponse } from "../_operatorRequest";

export const PUT = withDbError(
  "operator.settings.update",
  updatePlatformOperatorSettingsResponse
);
