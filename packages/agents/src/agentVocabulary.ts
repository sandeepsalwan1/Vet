import { z } from "zod";

export const agentIntentSchema = z.enum([
  "booking",
  "call",
  "checkin",
  "daily_ops",
  "followup",
  "invoice",
  "labs",
  "pickup",
  "pricing",
  "records",
  "sick_pet",
  "unknown"
]);

export const agentModeSchema = z.enum(["mock", "google-adk", "apify", "e2b-local", "e2b"]);

export type AgentIntent = z.infer<typeof agentIntentSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
export type TaskPriority = "low" | "medium" | "high";
export type TaskRequestType =
  | "prescription"
  | "labs_xrays"
  | "records_request"
  | "scheduling"
  | "patient_update";

export const mockLabVendor = "antech_mock";
export const mockLabDataSource = "mock lab data";
export const mockLabVendorShape = "antech_style";

export const mockDeliveryChannels = {
  clientPortal: "client_portal_mock",
  securePortal: "secure_portal_mock",
  schedulerIntake: "scheduler_intake_mock",
  frontDeskConsole: "front_desk_console_mock",
  clinicInbox: "clinic_inbox_mock",
  clinicalTriage: "clinical_triage_mock"
} as const;
