import type { ClientAnalyticsSnapshot } from "@central-vet/db";

export function analyticsPercent(value: number | null) {
  return value === null ? "Collecting" : `${value}%`;
}

export function analyticsMinutes(value: number | null) {
  if (value === null) return "Collecting";
  if (value < 1) return "<1 min";
  return `${Math.round(value)} min`;
}

export function analyticsDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function analyticsFreshness(value: string | null) {
  return value ? `Data through ${analyticsDateTime(value)}` : "Waiting for first event";
}

export function waitTimeChartData(
  stages: ClientAnalyticsSnapshot["waitStages"]
) {
  return stages
    .filter((stage) => stage.sampleSize > 0)
    .map((stage) => ({
      stage: stage.label,
      median: stage.medianMinutes,
      p90: stage.p90Minutes
    }));
}
