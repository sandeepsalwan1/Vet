import { withDbError } from "../_apiResponse";
import { authValidationResponse } from "./_authRequest";

export const POST = withDbError("auth.validate", authValidationResponse);
