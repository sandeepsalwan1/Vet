import { dbError } from "../_apiResponse";
import { authValidationResponse } from "./_authRequest";

export async function POST(request: Request) {
  try {
    return await authValidationResponse(request);
  } catch (error) {
    return dbError(error, { route: "auth.validate" });
  }
}
