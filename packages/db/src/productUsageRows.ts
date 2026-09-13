const minimumReturnCohortSize = 5;

export type PlatformUsageSummaryRow = {
  daily_active_users: number | string;
  active_hospitals: number | string;
  sessions_this_month: number | string;
  data_through: string | null;
};

export type PlatformUsageRetentionRow = {
  eligible_users: number | string;
  returned_users: number | string;
};

export type PlatformOperatorSettingsRow = {
  usage_alerts_enabled: boolean;
  return_rate_threshold: number | string;
  current_alert_state: "collecting" | "healthy" | "below";
  last_alerted_at: string | null;
  updated_at: string;
};

export type PlatformUsageSnapshot = {
  generatedAt: string;
  dataThrough: string | null;
  dailyActiveUsers: number;
  activeHospitals: number;
  sessionsThisMonth: number;
  returnRate: {
    percent: number | null;
    eligibleUsers: number;
    returnedUsers: number;
    minimumCohortSize: number;
    window: "days_8_to_30";
  };
  alert: {
    enabled: boolean;
    thresholdPercent: number;
    state: "collecting" | "healthy" | "below";
    lastSentAt: string | null;
    updatedAt: string;
  };
};

function nonNegativeInteger(value: number | string | null | undefined) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

function percent(numerator: number, denominator: number) {
  if (denominator < minimumReturnCohortSize) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function normalizePlatformUsageSnapshot(input: {
  summary: PlatformUsageSummaryRow | undefined;
  retention: PlatformUsageRetentionRow | undefined;
  settings: PlatformOperatorSettingsRow;
  generatedAt?: string;
}): PlatformUsageSnapshot {
  const eligibleUsers = nonNegativeInteger(input.retention?.eligible_users);
  const returnedUsers = Math.min(
    eligibleUsers,
    nonNegativeInteger(input.retention?.returned_users)
  );
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    dataThrough: input.summary?.data_through ?? null,
    dailyActiveUsers: nonNegativeInteger(input.summary?.daily_active_users),
    activeHospitals: nonNegativeInteger(input.summary?.active_hospitals),
    sessionsThisMonth: nonNegativeInteger(input.summary?.sessions_this_month),
    returnRate: {
      percent: percent(returnedUsers, eligibleUsers),
      eligibleUsers,
      returnedUsers,
      minimumCohortSize: minimumReturnCohortSize,
      window: "days_8_to_30"
    },
    alert: {
      enabled: input.settings.usage_alerts_enabled,
      thresholdPercent: Number(input.settings.return_rate_threshold),
      state: input.settings.current_alert_state,
      lastSentAt: input.settings.last_alerted_at,
      updatedAt: input.settings.updated_at
    }
  };
}
