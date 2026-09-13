import { withDbError } from "../../_apiResponse";
import { clientJourneyNotificationsResponse } from "../_notificationRequest";

export const dynamic = "force-dynamic";

const handler = withDbError(
  "notifications.client_journey",
  clientJourneyNotificationsResponse
);

export { handler as GET, handler as POST };
