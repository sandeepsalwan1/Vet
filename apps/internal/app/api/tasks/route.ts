import { withDbError } from "../_apiResponse";
import { taskCreateResponse } from "./_taskCreateRequest";
import { taskListResponse } from "./_taskListRequest";

export const GET = withDbError("tasks.list", taskListResponse);
export const POST = withDbError("tasks.create", taskCreateResponse);
