import { withDbError } from "../../_apiResponse";
import { datahubWebhookResponse } from "./_datahubWebhook";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const POST = withDbError(
  "integrations.datahub.post",
  async (request: Request) => datahubWebhookResponse(request)
);
