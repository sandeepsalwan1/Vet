import { z } from "zod";
import {
  agentIntentSchema,
  agentModeSchema,
  type AgentIntent,
  type AgentMode,
  type TaskPriority,
  type TaskRequestType
} from "./agentVocabulary";
import type { MockClinicData } from "./mockClinicContracts";

export type {
  AgentIntent,
  AgentMode,
  TaskPriority,
  TaskRequestType
} from "./agentVocabulary";
export type {
  MockAppointment,
  MockApproval,
  MockClinicData,
  MockClient,
  MockFollowup,
  MockInvoice,
  MockLabCatalogItem,
  MockLabOrder,
  MockLabResult,
  MockPet,
  MockReport,
  MockService,
  MockSlot,
  MockTask,
  PricingObservation,
  PricingRecommendation
} from "./mockClinicContracts";

const agentKindSchema = z.enum(["external", "internal"]);

const agentCapabilitySchema = z.enum([
  "external_booking",
  "external_records",
  "external_conversation",
  "internal_email",
  "internal_pricing",
  "internal_conversation",
  "internal_booking",
  "internal_ops",
  "internal_records",
  "internal_labs",
  "internal_invoice"
]);

const capabilityRiskLevelSchema = z.enum(["low", "medium", "high"]);

const capabilityCachePolicySchema = z.enum([
  "none",
  "short_greeting",
  "short_run_context"
]);

const capabilityNextActionSchema = z.enum([
  "answer",
  "ask_once",
  "block",
  "call_tool",
  "confirm"
]);

const capabilityDecisionRecordSchema = z.object({
  kind: z.string(),
  status: z.enum(["proposed", "confirmed", "completed", "blocked"]),
  ttl: z.enum(["short", "long", "permanent"]).optional()
});

export const capabilityRouteDecisionSchema = z.object({
  agent: agentKindSchema,
  agentKind: agentKindSchema,
  capability: agentCapabilitySchema,
  parsedInput: z.record(z.string(), z.unknown()),
  requiredMissingFields: z.array(z.string()),
  riskLevel: capabilityRiskLevelSchema,
  cachePolicy: capabilityCachePolicySchema,
  nextAction: capabilityNextActionSchema
});

const actorSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(["staff", "va", "task_adder", "veterinarian", "admin"]).optional(),
  profileId: z.string().optional().nullable()
});

export const agentInputSchema = z.object({
  intent: agentIntentSchema.optional(),
  scenario: agentIntentSchema.optional(),
  message: z.string().optional(),
  request: z.string().optional(),
  transcript: z.string().optional(),
  body: z.string().optional(),
  clientName: z.string().optional(),
  clientPhone: z.string().optional(),
  callerName: z.string().optional(),
  callerPhone: z.string().optional(),
  petName: z.string().optional(),
  appointmentType: z.string().optional(),
  destination: z.string().optional(),
  live: z.boolean().optional(),
  actor: actorSchema.optional()
}).passthrough();

export type AgentKind = z.infer<typeof agentKindSchema>;
export type AgentCapability = z.infer<typeof agentCapabilitySchema>;
export type CapabilityRiskLevel = z.infer<typeof capabilityRiskLevelSchema>;
export type CapabilityCachePolicy = z.infer<typeof capabilityCachePolicySchema>;
export type CapabilityNextAction = z.infer<typeof capabilityNextActionSchema>;
type CapabilityDecisionRecord = z.infer<typeof capabilityDecisionRecordSchema>;
export type CapabilityRouteDecision = z.infer<typeof capabilityRouteDecisionSchema>;
export type AgentInput = z.infer<typeof agentInputSchema>;
type Actor = z.infer<typeof actorSchema>;

export type AgentTaskDraft = {
  id: string;
  kind: "task";
  status: "pending_review" | "due" | "pending";
  priority: TaskPriority;
  requestType: TaskRequestType;
  clientName: string | null;
  clientPhone: string | null;
  petName: string | null;
  request: string;
  notes: string | null;
  dueTimeHint?: string;
};

export type AgentApprovalDraft = {
  id: string;
  kind: "approval";
  approvalType: "records_transfer" | "billing_review" | "pricing_review";
  title: string;
  summary: string;
  requestedAction: Record<string, unknown>;
  taskId?: string | null;
};

export type AgentReportDraft = {
  id: string;
  kind: "report";
  reportType: "daily_ops" | "followup" | "invoice" | "pricing";
  title: string;
  summary: string;
  data: Record<string, unknown>;
  taskId?: string | null;
};

export type WorkflowEventDraft = {
  id: string;
  workflowType: AgentIntent;
  eventType: string;
  title: string;
  detail: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ToolCallTrace = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  result: Record<string, unknown>;
  status?: "ok" | "error";
  error?: string | null;
  durationMs?: number;
  createdAt: string;
};

export type AgentEffect =
  | AgentTaskDraft
  | AgentApprovalDraft
  | AgentReportDraft
  | WorkflowEventDraft;

export type AgentWorkflowResult = {
  ok: true;
  mode: AgentMode;
  intent: AgentIntent;
  capability?: AgentCapability;
  capabilityDecision?: CapabilityRouteDecision;
  decision?: CapabilityDecisionRecord;
  message: string;
  result: Record<string, unknown>;
  task?: AgentTaskDraft;
  approval?: AgentApprovalDraft;
  report?: AgentReportDraft;
  workflowEvents: WorkflowEventDraft[];
  runId: string;
  effects: AgentEffect[];
  toolCalls: ToolCallTrace[];
};

export type RunAgentOptions = {
  mode?: AgentMode;
  runId?: string;
  traceId?: string;
  routeIntent?: string;
  now?: Date;
  model?: string;
  clinicData?: MockClinicData;
};
