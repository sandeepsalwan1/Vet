import { dbError } from "../_apiResponse";
import {
  arrivalDeskPatchResponse,
  arrivalIntakeGetResponse,
  publicArrivalActionResponse
} from "./_arrivalIntakeRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await arrivalIntakeGetResponse(request);
  } catch (error) {
    return dbError(error, { route: "arrival-intake.get" });
  }
}

export async function POST(request: Request) {
  try {
    return await publicArrivalActionResponse(request);
  } catch (error) {
    return dbError(error, { route: "arrival-intake.post" });
  }
}

export async function PATCH(request: Request) {
  try {
    return await arrivalDeskPatchResponse(request);
  } catch (error) {
    return dbError(error, { route: "arrival-intake.patch" });
  }
}
