import { withDbError } from "../../_apiResponse";
import {
  clearPlatformOperatorSession,
  createPlatformOperatorSession
} from "../_operatorRequest";

export const POST = withDbError(
  "operator.session.create",
  createPlatformOperatorSession
);

export function DELETE() {
  return clearPlatformOperatorSession();
}
