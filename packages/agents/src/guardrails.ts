import type { AgentInput, TaskPriority } from "./contracts";
import { getInputText } from "./tools";

type GuardrailDecision = {
  allowed: boolean;
  risk: "none" | "medical" | "records" | "billing" | "pricing";
  priority: TaskPriority;
  message: string | null;
  reasons: string[];
};

const medicalTerms = [
  "blood",
  "breathing",
  "choking",
  "collapse",
  "diarrhea",
  "emergency",
  "lethargic",
  "pain",
  "poison",
  "seizure",
  "toxin",
  "vomit"
];

export function checkMedicalGuardrail(input: AgentInput): GuardrailDecision {
  const text = getInputText(input).toLowerCase();
  const matched = medicalTerms.filter((term) => text.includes(term));
  if (!matched.length) {
    return {
      allowed: true,
      risk: "none",
      priority: "low",
      message: null,
      reasons: []
    };
  }

  return {
    allowed: false,
    risk: "medical",
    priority: matched.some((term) => ["blood", "breathing", "choking", "collapse", "seizure", "poison", "toxin"].includes(term))
      ? "high"
      : "medium",
    message: "I cannot diagnose or recommend treatment. I flagged this for the clinical team. If this is an emergency, call the hospital or go to the nearest emergency clinic now.",
    reasons: matched
  };
}

export function checkBillingGuardrail(action: string): GuardrailDecision {
  const risky = /(refund|charge|discount|void|write.?off|change.*invoice)/i.test(action);
  return {
    allowed: !risky,
    risk: risky ? "billing" : "none",
    priority: risky ? "medium" : "low",
    message: risky ? "Billing changes are blocked. I can produce an invoice audit report instead." : null,
    reasons: risky ? ["billing_mutation_requires_review"] : []
  };
}

export function checkPricingGuardrail(action: string): GuardrailDecision {
  const risky = /(update|change|set|raise|lower).*price/i.test(action);
  return {
    allowed: !risky,
    risk: risky ? "pricing" : "none",
    priority: risky ? "medium" : "low",
    message: risky ? "Prices are not changed automatically. I can create a pricing report instead." : null,
    reasons: risky ? ["pricing_mutation_blocked"] : []
  };
}
