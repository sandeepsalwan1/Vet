import { withDbError } from "../_apiResponse";
import {
  settingsPatchResponse,
  settingsReadResponse
} from "./_settingsRequest";

export const GET = withDbError("settings.read", settingsReadResponse);
export const PATCH = withDbError("settings.update", settingsPatchResponse);
