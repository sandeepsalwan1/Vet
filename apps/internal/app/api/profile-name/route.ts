import { withDbError } from "../_apiResponse";
import { profileNameUpdateResponse } from "./_profileNameRequest";

export const PATCH = withDbError(
  "profile-name.update",
  profileNameUpdateResponse
);
