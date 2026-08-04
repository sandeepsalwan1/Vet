import { dbError } from "../../_apiResponse";
import { datahubWebhookResponse } from "./_datahubWebhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return await datahubWebhookResponse(request);
  } catch (error) {
    return dbError(error, { route: "integrations.datahub.post" });
  }
}
