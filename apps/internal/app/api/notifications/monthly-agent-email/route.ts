import { dbError } from "../../_apiResponse";
import { monthlyAgentEmailResponse } from "../_notificationRequest";

export const dynamic = "force-dynamic";

async function handler(request: Request) {
  try {
    return await monthlyAgentEmailResponse(request);
  } catch (error) {
    return dbError(error, { route: "notifications.monthly_agent_email" });
  }
}

export async function GET(request: Request) {
  return handler(request);
}

export async function POST(request: Request) {
  return handler(request);
}
