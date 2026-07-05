import { dbError } from "../_apiResponse";
import { taskCreateResponse } from "./_taskCreateRequest";
import { taskListResponse } from "./_taskListRequest";

export async function GET(request: Request) {
  try {
    return await taskListResponse(request);
  } catch (error) {
    return dbError(error, { route: "tasks.list" });
  }
}

export async function POST(request: Request) {
  try {
    return await taskCreateResponse(request);
  } catch (error) {
    return dbError(error, { route: "tasks.create" });
  }
}
