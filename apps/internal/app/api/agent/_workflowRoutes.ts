import type { AgentIntent } from "@central-vet/agents";

export type AgentKind = "external" | "internal";
export type RouteIntent =
  | "checkin"
  | "booking"
  | "pickup"
  | "records"
  | "followup"
  | "call"
  | "daily_ops"
  | "invoice"
  | "pricing"
  | "external"
  | "internal";

type AgentWorkflowRoute = {
  agent: AgentKind;
  routeIntent: RouteIntent;
  auth: "public" | "manager";
};

const workflowRoutes = {
  booking: { agent: "external", routeIntent: "booking", auth: "public" },
  call: { agent: "external", routeIntent: "call", auth: "public" },
  checkin: { agent: "external", routeIntent: "checkin", auth: "public" },
  "daily-ops": { agent: "internal", routeIntent: "daily_ops", auth: "manager" },
  external: { agent: "external", routeIntent: "external", auth: "public" },
  followup: { agent: "external", routeIntent: "followup", auth: "public" },
  internal: { agent: "internal", routeIntent: "internal", auth: "manager" },
  invoice: { agent: "internal", routeIntent: "invoice", auth: "manager" },
  pickup: { agent: "external", routeIntent: "pickup", auth: "public" },
  pricing: { agent: "internal", routeIntent: "pricing", auth: "manager" },
  records: { agent: "external", routeIntent: "records", auth: "public" }
} satisfies Record<string, AgentWorkflowRoute>;

const concreteRouteIntents = new Set<RouteIntent>([
  "checkin",
  "booking",
  "pickup",
  "records",
  "followup",
  "call",
  "daily_ops",
  "invoice",
  "pricing"
]);

export function getAgentWorkflowRoute(slug: string) {
  return workflowRoutes[slug as keyof typeof workflowRoutes] ?? null;
}

export function normalizeAgentRouteInput(routeIntent: RouteIntent, input: Record<string, unknown>) {
  if (!concreteRouteIntents.has(routeIntent)) return input;
  return { ...input, intent: routeIntent };
}

export function workflowEventIntent(routeIntent: RouteIntent): AgentIntent {
  return concreteRouteIntents.has(routeIntent) ? routeIntent as AgentIntent : "unknown";
}
