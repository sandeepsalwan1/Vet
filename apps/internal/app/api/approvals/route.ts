import { withDbError } from "../_apiResponse";
import {
  approvalCreateResponse,
  approvalListResponse
} from "./_approvalRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError("approvals.list", approvalListResponse);
export const POST = withDbError("approvals.create", approvalCreateResponse);
