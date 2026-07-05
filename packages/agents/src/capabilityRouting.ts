import type {
  AgentCapability,
  AgentInput,
  AgentIntent,
  AgentKind,
  AgentWorkflowResult,
  CapabilityCachePolicy,
  CapabilityNextAction,
  CapabilityRiskLevel,
  CapabilityRouteDecision
} from "./contracts";
import { capabilityRouteDecisionSchema } from "./contracts";
import { getInputText } from "./tools";

const externalBlockedIntents = new Set<AgentIntent>([
  "daily_ops",
  "invoice",
  "labs",
  "pricing"
]);

const externalIntentCapabilities: Record<AgentIntent, AgentCapability> = {
  booking: "external_booking",
  call: "external_conversation",
  checkin: "external_booking",
  daily_ops: "external_conversation",
  followup: "external_conversation",
  invoice: "external_conversation",
  labs: "external_conversation",
  pickup: "external_booking",
  pricing: "external_conversation",
  records: "external_records",
  sick_pet: "external_conversation",
  unknown: "external_conversation"
};

const internalIntentCapabilities: Record<AgentIntent, AgentCapability> = {
  booking: "internal_booking",
  call: "internal_conversation",
  checkin: "internal_booking",
  daily_ops: "internal_ops",
  followup: "internal_conversation",
  invoice: "internal_invoice",
  labs: "internal_labs",
  pickup: "internal_booking",
  pricing: "internal_pricing",
  records: "internal_records",
  sick_pet: "internal_conversation",
  unknown: "internal_conversation"
};

function missingFields(input: AgentInput, intent: AgentIntent) {
  const missing: string[] = [];
  const clientName = input.clientName ?? input.callerName;
  const clientPhone = input.clientPhone ?? input.callerPhone;

  if ((intent === "booking" || intent === "checkin" || intent === "pickup") && !clientName && !clientPhone) {
    missing.push("clientName_or_clientPhone");
  }
  if ((intent === "booking" || intent === "checkin" || intent === "pickup") && !input.petName) {
    missing.push("petName");
  }
  if (intent === "records" && !input.destination) missing.push("destination");
  if (intent === "labs" && !input.petName) missing.push("petName_or_labOrderId");
  return missing;
}

function riskLevel(agentKind: AgentKind, intent: AgentIntent): CapabilityRiskLevel {
  if (intent === "sick_pet") return "high";
  if (agentKind === "external" && externalBlockedIntents.has(intent)) return "high";
  if (intent === "pricing" || intent === "invoice" || intent === "labs" || intent === "records") return "medium";
  return "low";
}

function cachePolicy(intent: AgentIntent, text: string): CapabilityCachePolicy {
  const normalized = text.trim().toLowerCase();
  if (intent === "unknown" && /^(hi|hello|hey|thanks|thank you)[.! ]*$/.test(normalized)) return "short_greeting";
  if (intent === "call" || intent === "checkin" || intent === "pickup") return "short_run_context";
  return "none";
}

function nextAction(input: {
  agentKind: AgentKind;
  intent: AgentIntent;
  missing: string[];
  risk: CapabilityRiskLevel;
}): CapabilityNextAction {
  if (input.agentKind === "external" && externalBlockedIntents.has(input.intent)) return "block";
  if (input.missing.length) return "ask_once";
  if (input.risk === "high" && input.intent !== "sick_pet") return "confirm";
  if (input.intent === "unknown") return "answer";
  return "call_tool";
}

function parsedInput(input: AgentInput, text: string) {
  return {
    message: text || null,
    clientName: input.clientName ?? input.callerName ?? null,
    clientPhone: input.clientPhone ?? input.callerPhone ?? null,
    petName: input.petName ?? null,
    appointmentType: input.appointmentType ?? null,
    destination: input.destination ?? null,
    live: input.live ?? false
  };
}

export function decideCapabilityRoute(
  agentKind: AgentKind,
  input: AgentInput,
  intent: AgentIntent
): CapabilityRouteDecision {
  const text = getInputText(input);
  const missing = missingFields(input, intent);
  const risk = riskLevel(agentKind, intent);
  return capabilityRouteDecisionSchema.parse({
    agent: agentKind,
    agentKind,
    capability: agentKind === "external"
      ? externalIntentCapabilities[intent]
      : internalIntentCapabilities[intent],
    parsedInput: parsedInput(input, text),
    requiredMissingFields: missing,
    riskLevel: risk,
    cachePolicy: cachePolicy(intent, text),
    nextAction: nextAction({ agentKind, intent, missing, risk })
  });
}

export function withCapabilityDecision(
  result: AgentWorkflowResult,
  decision: CapabilityRouteDecision
): AgentWorkflowResult {
  return {
    ...result,
    capability: decision.capability,
    capabilityDecision: decision,
    result: {
      ...result.result,
      capability: decision.capability,
      capabilityDecision: decision
    }
  };
}
