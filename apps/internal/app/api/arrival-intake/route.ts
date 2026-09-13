import { withDbError } from "../_apiResponse";
import {
  arrivalDeskPatchResponse,
  arrivalIntakeGetResponse,
  publicArrivalActionResponse
} from "./_arrivalIntakeRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError("arrival-intake.get", arrivalIntakeGetResponse);
export const POST = withDbError(
  "arrival-intake.post",
  publicArrivalActionResponse
);
export const PATCH = withDbError(
  "arrival-intake.patch",
  arrivalDeskPatchResponse
);
