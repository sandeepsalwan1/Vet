import { withDbError } from "../../_apiResponse";
import { monthlyAgentEmailResponse } from "../_notificationRequest";

export const dynamic = "force-dynamic";

const handler = withDbError(
  "notifications.monthly_agent_email",
  monthlyAgentEmailResponse
);

export { handler as GET, handler as POST };
