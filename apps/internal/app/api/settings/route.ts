import { dbError } from "../_apiResponse";
import {
  settingsPatchResponse,
  settingsReadResponse
} from "./_settingsRequest";

export async function GET(request: Request) {
  try {
    return await settingsReadResponse(request);
  } catch (error) {
    return dbError(error, { route: "settings.read" });
  }
}

export async function PATCH(request: Request) {
  try {
    return await settingsPatchResponse(request);
  } catch (error) {
    return dbError(error, { route: "settings.update" });
  }
}
