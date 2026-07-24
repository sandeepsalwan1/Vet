const analyticsRangeDays = [30, 90, 365] as const;

export type AnalyticsRangeDays = typeof analyticsRangeDays[number];

export type ClientVisitStage =
  | "checked_in"
  | "roomed"
  | "care_started"
  | "care_complete"
  | "checkout_complete";

export type WaitStageMetric = {
  key: string;
  label: string;
  description: string;
  medianMinutes: number | null;
  p90Minutes: number | null;
  sampleSize: number;
};

export type ClientAnalyticsSnapshot = {
  rangeDays: AnalyticsRangeDays;
  generatedAt: string;
  dataThrough: string | null;
  visits: {
    completed: number;
    clients: number;
    returningClients: number;
    returnRate: number | null;
    rebookedClients: number;
    rebookRate: number | null;
  };
  waitStages: WaitStageMetric[];
  experience: {
    positive: number;
    responses: number;
    positiveRate: number | null;
    promptsSent: number;
    responseRate: number | null;
  };
  petHealth: {
    doingWell: number;
    concerns: number;
    responses: number;
    doingWellRate: number | null;
    promptsSent: number;
    responseRate: number | null;
  };
  followup: {
    emailAfterHours: number;
    callAfterHours: number;
    emailsSent: number;
    awaitingResponse: number;
    callsDue: number;
    items: Array<{
      clientId: string;
      clientName: string;
      petName: string;
      phone: string;
      appointmentId: string | null;
      emailSentAt: string;
      callDueAt: string;
    }>;
  };
};

export type WaitMetricRow = {
  key: string;
  median_minutes: number | string | null;
  p90_minutes: number | string | null;
  sample_size: number | string;
};

const waitStageDefinitions = [
  {
    key: "check_in_to_room",
    label: "Check-in to room",
    description: "Time after completed check-in before room placement."
  },
  {
    key: "room_to_care",
    label: "Room to care team",
    description: "Time in the room before clinical care starts."
  },
  {
    key: "care_time",
    label: "With care team",
    description: "Time from the start of care until the pet is ready."
  },
  {
    key: "ready_to_checkout",
    label: "Ready to checkout",
    description: "Time from care completion through payment and discharge."
  },
  {
    key: "total_visit",
    label: "Total visit",
    description: "Time from completed check-in through checkout."
  }
] as const;

function finiteNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundedMinutes(value: number | string | null) {
  const number = finiteNumber(value);
  return number === null ? null : Math.round(number * 10) / 10;
}

export function ratePercent(numerator: number, denominator: number) {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function normalizeWaitStages(rows: WaitMetricRow[]): WaitStageMetric[] {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  return waitStageDefinitions.map((definition) => {
    const row = byKey.get(definition.key);
    return {
      ...definition,
      medianMinutes: roundedMinutes(row?.median_minutes ?? null),
      p90Minutes: roundedMinutes(row?.p90_minutes ?? null),
      sampleSize: Math.max(0, Math.trunc(finiteNumber(row?.sample_size) ?? 0))
    };
  });
}
