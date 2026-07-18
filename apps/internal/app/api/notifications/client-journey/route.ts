import { dbError } from "../../_apiResponse";
import { clientJourneyNotificationsResponse } from "../_notificationRequest";

export const dynamic = "force-dynamic";

async function handler(request: Request) {
  try {
    return await clientJourneyNotificationsResponse(request);
  } catch (error) {
    return dbError(error, { route: "notifications.client_journey" });
  }
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
