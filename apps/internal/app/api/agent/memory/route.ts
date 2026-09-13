import { withDbError } from "../../_apiResponse";
import {
  memoryCorrectionResponse,
  memoryCreateResponse,
  memoryDeleteResponse,
  memoryListResponse
} from "./_memoryRequest";

export const dynamic = "force-dynamic";

export const GET = withDbError("agent.memory.list", memoryListResponse);
export const POST = withDbError("agent.memory.create", memoryCreateResponse);
export const PATCH = withDbError(
  "agent.memory.correct",
  memoryCorrectionResponse
);
export const DELETE = withDbError("agent.memory.delete", memoryDeleteResponse);
