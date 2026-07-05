import { dbError } from "../_apiResponse";
import {
  approvalCreateResponse,
  approvalListResponse
} from "./_approvalRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await approvalListResponse(request);
  } catch (error) {
    return dbError(error, { route: "approvals.list" });
  }
}

export async function POST(request: Request) {
  try {
    return await approvalCreateResponse(request);
  } catch (error) {
    return dbError(error, { route: "approvals.create" });
  }
}
