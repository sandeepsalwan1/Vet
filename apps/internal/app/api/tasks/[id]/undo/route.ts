import { withDbError } from "../../../_apiResponse";
import { taskUndoResponse } from "./_taskUndoRequest";

export const POST = withDbError(
  "tasks.undo",
  async (
    request: Request,
    context: { params: Promise<{ id: string }> }
  ) => {
    const { id } = await context.params;
    return taskUndoResponse({ request, id });
  }
);
