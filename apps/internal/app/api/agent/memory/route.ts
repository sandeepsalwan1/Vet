import { dbError } from "../../_apiResponse";
import {
  memoryCorrectionResponse,
  memoryCreateResponse,
  memoryDeleteResponse,
  memoryListResponse
} from "./_memoryRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await memoryListResponse(request);
  } catch (error) {
    return dbError(error, { route: "agent.memory.list" });
  }
}

export async function POST(request: Request) {
  try {
    return await memoryCreateResponse(request);
  } catch (error) {
    return dbError(error, { route: "agent.memory.create" });
  }
}

export async function PATCH(request: Request) {
  try {
    return await memoryCorrectionResponse(request);
  } catch (error) {
    return dbError(error, { route: "agent.memory.correct" });
  }
}

export async function DELETE(request: Request) {
  try {
    return await memoryDeleteResponse(request);
  } catch (error) {
    return dbError(error, { route: "agent.memory.delete" });
  }
}
