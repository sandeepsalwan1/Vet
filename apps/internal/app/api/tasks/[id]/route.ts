import { withDbError } from "../../_apiResponse";
import { taskUpdateResponse } from "./_taskUpdateRequest";

export const PATCH = withDbError(
  "tasks.update",
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await context.params;
    return taskUpdateResponse({ request, id });
  }
);
