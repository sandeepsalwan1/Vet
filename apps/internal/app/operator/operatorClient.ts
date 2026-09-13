export type OperatorSnapshot = {
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
    recipientConfigured: boolean;
    recipient: string | null;
  };
};

async function responseJson<T>(response: Response) {
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const error = new Error(body.error || "Something went wrong.");
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body;
}

export function operatorErrorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : null;
}

export function operatorErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

export async function readOperatorSnapshot() {
  return responseJson<OperatorSnapshot>(await fetch("/api/operator/analytics", {
    cache: "no-store"
  }));
}

export async function createOperatorSession(passcode: string) {
  return responseJson<{ ok: true }>(await fetch("/api/operator/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ passcode })
  }));
}

export async function clearOperatorSession() {
  return responseJson<{ ok: true }>(await fetch("/api/operator/session", {
    method: "DELETE"
  }));
}

export async function setOperatorUsageAlerts(enabled: boolean) {
  return responseJson<OperatorSnapshot["alert"]>(await fetch("/api/operator/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled })
  }));
}
