import {
  createPlatformOperatorNotificationAttempt,
  getPlatformUsageSnapshot,
  markPlatformOperatorNotification,
  updatePlatformUsageAlertState,
  type PlatformUsageSnapshot
} from "@central-vet/db";
import {
  createNotificationSender,
  type NotificationAttemptAdapter
} from "./notificationSend";

const reminderCooldownDays = 30;

type AlertDecisionInput = {
  enabled: boolean;
  percent: number | null;
  thresholdPercent: number;
  previousState: "collecting" | "healthy" | "below";
  lastSentAt: string | null;
  now: Date;
};

const operatorNotificationAttempts: NotificationAttemptAdapter = {
  create(input) {
    return createPlatformOperatorNotificationAttempt({
      notificationType: input.notificationType,
      recipient: input.recipient,
      idempotencyKey: input.idempotencyKey
    }).then((attempt) => attempt.duplicate
      ? {
          duplicate: true as const,
          priorStatus: attempt.status
        }
      : { id: attempt.id });
  },
  mark(outcome) {
    return markPlatformOperatorNotification({
      id: outcome.id,
      status: outcome.status,
      providerId: outcome.providerId,
      error: outcome.error
    });
  }
};

const sendOperatorNotification = createNotificationSender(
  operatorNotificationAttempts
);

export type OperatorUsageAlertDecision = {
  state: "collecting" | "healthy" | "below";
  shouldSend: boolean;
  reason: "disabled" | "collecting" | "healthy" | "crossed_below" | "reminder_due" | "cooldown";
};

export function operatorUsageAlertWasDelivered(
  result: {
    status: "sent" | "skipped" | "duplicate" | "failed";
    priorStatus?: "pending" | "sent" | "skipped" | "failed";
  }
) {
  return result.status === "sent" ||
    (result.status === "duplicate" && result.priorStatus === "sent");
}

export function decideOperatorUsageAlert(input: AlertDecisionInput): OperatorUsageAlertDecision {
  if (input.percent === null) {
    return { state: "collecting", shouldSend: false, reason: "collecting" };
  }
  if (input.percent >= input.thresholdPercent) {
    return { state: "healthy", shouldSend: false, reason: "healthy" };
  }
  if (!input.enabled) {
    return { state: "below", shouldSend: false, reason: "disabled" };
  }
  if (input.previousState !== "below" || !input.lastSentAt) {
    return { state: "below", shouldSend: true, reason: "crossed_below" };
  }
  const reminderAt = new Date(input.lastSentAt).getTime() +
    reminderCooldownDays * 24 * 60 * 60 * 1000;
  if (input.now.getTime() >= reminderAt) {
    return { state: "below", shouldSend: true, reason: "reminder_due" };
  }
  return { state: "below", shouldSend: false, reason: "cooldown" };
}

function alertHtml(snapshot: PlatformUsageSnapshot) {
  const percent = snapshot.returnRate.percent ?? 0;
  return `
    <div style="font-family:Arial,sans-serif;color:#172033;line-height:1.5;">
      <p style="margin:0 0 6px;color:#667085;font-size:13px;">Vet product pulse</p>
      <h1 style="font-size:22px;margin:0 0 12px;">Week 2+ return is ${percent}%</h1>
      <p style="margin:0 0 12px;">
        This is below your ${snapshot.alert.thresholdPercent}% alert threshold.
      </p>
      <p style="margin:0;color:#667085;">
        ${snapshot.returnRate.returnedUsers} of ${snapshot.returnRate.eligibleUsers}
        eligible clinic-team users returned during days 8–30.
      </p>
    </div>
  `;
}

async function sendOperatorUsageAlertEmail(input: {
  snapshot: PlatformUsageSnapshot;
  recipient: string;
  now: Date;
}) {
  const date = input.now.toISOString().slice(0, 10);
  const [result] = await sendOperatorNotification({
    notificationType: "operator_low_return",
    subject: `Vet return rate is below ${input.snapshot.alert.thresholdPercent}%`,
    html: alertHtml(input.snapshot),
    text: `Vet return rate is ${input.snapshot.returnRate.percent ?? 0}%.`,
    idempotencyKeyBase: `operator-low-return/${date}`,
    modeOverride: "production",
    channelOverride: "email",
    deliveriesOverride: [{
      channel: "email",
      recipients: [input.recipient]
    }]
  });
  return result ?? {
    status: "failed" as const,
    reason: "Notification result was unavailable."
  };
}

export async function evaluateOperatorUsageAlert(now = new Date()) {
  const snapshot = await getPlatformUsageSnapshot();
  const decision = decideOperatorUsageAlert({
    enabled: snapshot.alert.enabled,
    percent: snapshot.returnRate.percent,
    thresholdPercent: snapshot.alert.thresholdPercent,
    previousState: snapshot.alert.state,
    lastSentAt: snapshot.alert.lastSentAt,
    now
  });
  if (!decision.shouldSend) {
    await updatePlatformUsageAlertState({ state: decision.state });
    return {
      checked: true,
      sent: false,
      state: decision.state,
      reason: decision.reason
    };
  }

  const recipient = process.env.PLATFORM_OPERATOR_EMAIL?.trim() || "";
  if (!recipient) {
    await updatePlatformUsageAlertState({ state: decision.state });
    return {
      checked: true,
      sent: false,
      state: decision.state,
      reason: "recipient_not_configured" as const
    };
  }

  const result = await sendOperatorUsageAlertEmail({ snapshot, recipient, now });
  const delivered = operatorUsageAlertWasDelivered(result);
  await updatePlatformUsageAlertState({
    state: decision.state,
    alertedAt: delivered ? now.toISOString() : null
  });
  return {
    checked: true,
    sent: delivered,
    state: decision.state,
    reason: result.status
  };
}
