import type {
  AgentInput,
  AgentReportDraft,
  AgentWorkflowResult,
  PricingRecommendation,
  RunAgentOptions
} from "./contracts";
import { checkPricingGuardrail } from "./guardrails";
import {
  buildResult,
  createRuntime,
  normalizeAgentInput,
  resolveMode
} from "./mockProvider";
import { executeTool, getInputText } from "./tools";

type PriceComparison = {
  deltaCents: number | null;
  flagged: boolean;
  recommendation: string;
  observation: {
    observedPriceCents?: number | null;
    serviceName: string;
  };
  service?: {
    id: string;
    serviceName: string;
    currentPriceCents: number;
  } | null;
};

function recommendationFor(comparison: PriceComparison): PricingRecommendation {
  const service = comparison.service;
  const currentPriceCents = service?.currentPriceCents ?? 0;
  const observedPriceCents = comparison.observation.observedPriceCents ?? null;
  const delta = comparison.deltaCents;
  const action =
    !service || delta === null ? "manual_review"
      : delta > 1000 ? "raise"
        : delta < -1000 ? "lower"
          : "keep";
  return {
    serviceId: service?.id ?? `unknown-${comparison.observation.serviceName}`,
    serviceName: service?.serviceName ?? comparison.observation.serviceName,
    currentPriceCents,
    competitorLowCents: observedPriceCents,
    competitorMedianCents: observedPriceCents,
    competitorHighCents: observedPriceCents,
    proposedPriceCents: action === "keep" || action === "manual_review" ? null : observedPriceCents,
    confidence: service && observedPriceCents !== null ? "medium" : "low",
    reason: comparison.recommendation,
    action
  };
}

export async function runPricingAgent(input: AgentInput | unknown, options: RunAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = "pricing";
  const requestedMode = resolveMode(options);
  const runtime = createRuntime(normalized, intent, options);
  const guardrail = checkPricingGuardrail(getInputText(normalized));

  await executeTool("list_service_catalog", {}, runtime);
  const scan = await executeTool("run_competitor_scan", {
    source: normalized.live ? "apify" : "sample"
  }, runtime) as { mode?: "mock" | "apify" };
  const mode = scan.mode === "apify" ? "apify" : requestedMode === "google-adk" ? "google-adk" : "mock";
  const comparisonResult = await executeTool("compare_service_prices", {}, runtime) as {
    comparisons: PriceComparison[];
  };
  const flagged = comparisonResult.comparisons.filter((comparison) => comparison.flagged);
  const recommendations = comparisonResult.comparisons.map(recommendationFor);
  const summary = `${flagged.length} pricing item(s) need review. No service prices were changed.`;
  const reportResult = await executeTool("create_price_review_report", {
    summary,
    flaggedCount: flagged.length,
    comparisons: comparisonResult.comparisons,
    recommendations
  }, runtime) as {
    report: AgentReportDraft;
  };

  return buildResult({
    intent,
    mode,
    message: guardrail.allowed ? summary : guardrail.message ?? summary,
    result: {
      changedPrices: false,
      comparisons: comparisonResult.comparisons,
      flagged,
      recommendations
    },
    runtime,
    options,
    report: reportResult.report
  });
}
