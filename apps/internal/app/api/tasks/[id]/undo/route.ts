import { dbError } from "../../../_apiResponse";
import { taskUndoResponse } from "./_taskUndoRequest";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    return await taskUndoResponse({ request, id });
  } catch (error) {
    return dbError(error, { route: "tasks.undo" });
  }
}
