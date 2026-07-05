import { dbError } from "../_apiResponse";
import { profileNameUpdateResponse } from "./_profileNameRequest";

export async function PATCH(request: Request) {
  try {
    return await profileNameUpdateResponse(request);
  } catch (error) {
    return dbError(error, { route: "profile-name.update" });
  }
}
