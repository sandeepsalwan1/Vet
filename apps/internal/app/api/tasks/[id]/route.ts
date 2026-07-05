import { dbError } from "../../_apiResponse";
import { taskUpdateResponse } from "./_taskUpdateRequest";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return await taskUpdateResponse({ request, id });
  } catch (error) {
    return dbError(error, { route: "tasks.update" });
  }
}
