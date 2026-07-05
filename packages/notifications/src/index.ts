import { randomUUID } from "node:crypto";
import {
  archiveCompletedTasksBefore,
  getClinicById,
  isEndOfDayAlertsEnabled,
  listIncompletePriorityTasks,
  type Task
} from "@central-vet/db";
import {
  agentExampleHtml,
  agentExampleText,
  dailyPrioritySummaryHtml,
  dailyPrioritySummaryText,
  escalationHtml,
  escalationText,
  smokeTestHtml
} from "./notificationContent";
import {
  localNotificationParts,
  notificationEmailFrom,
  notificationMode,
  veterinarianDeliveries,
  type NotificationChannel,
  type NotificationMode
} from "./notificationDelivery";
import { sendNotification, type SendResult } from "./notificationSend";

type AgentEmailCadence = "once" | "monthly" | "post_appointment";
export { notificationEmailFrom };
export type { NotificationMode };

const systemActor = { name: "System", role: "admin" as const };
const defaultClinicName = "Central Veterinary Hospital";

async function clinicNameFor(clinicId: string | null | undefined) {
  if (!clinicId) return process.env.HOSPITAL_NAME || defaultClinicName;
  const clinic = await getClinicById(clinicId);
  return clinic?.name || process.env.HOSPITAL_NAME || defaultClinicName;
}

export async function sendEscalationAlert(task: Task, options?: {
  modeOverride?: NotificationMode;
}) {
  const deliveries = await veterinarianDeliveries("escalation", { clinicId: task.clinicId });
  const clinicName = await clinicNameFor(task.clinicId);

  if (deliveries.length === 0) {
    return {
      taskId: task.id,
      skipped: true,
      reason: "All veterinarian escalation notifications are opted out.",
      results: [] as SendResult[]
    };
  }

  const results = await sendNotification({
    clinicId: task.clinicId,
    clinicName,
    notificationType: "escalation",
    subject: `${clinicName} escalated task: ${task.petName || task.clientName || "Task"}`,
    html: escalationHtml(task, clinicName),
    text: escalationText(task, clinicName),
    idempotencyKeyBase: `escalation/${task.id}/${task.escalatedAt || "new"}`,
    taskId: task.id,
    modeOverride: options?.modeOverride,
    deliveriesOverride: deliveries
  });
  return { taskId: task.id, skipped: false, results };
}

export async function sendDailyPrioritySummary(options?: {
  clinicId?: string | null;
  timeZone?: string;
  modeOverride?: NotificationMode;
  channelOverride?: NotificationChannel;
  force?: boolean;
}) {
  const timeZone = options?.timeZone || process.env.APP_TIME_ZONE || process.env.TZ || "America/Los_Angeles";
  const clinicName = await clinicNameFor(options?.clinicId);
  const { date, hour } = localNotificationParts(timeZone);
  const requiredHour = Number(process.env.DAILY_PRIORITY_SUMMARY_HOUR ?? 18);
  const archivedCompleted = await archiveCompletedTasksBefore(
    date,
    systemActor,
    timeZone,
    { clinicId: options?.clinicId }
  );
  if (!options?.force && hour < requiredHour) {
    return {
      skipped: true,
      reason: `Local hour ${hour} is before ${requiredHour}.`,
      localDate: date,
      archivedCompletedCount: archivedCompleted.length,
      taskCount: 0,
      results: [] as SendResult[]
    };
  }
  if (!options?.force && !(await isEndOfDayAlertsEnabled({ clinicId: options?.clinicId }))) {
    return {
      skipped: true,
      reason: "End-of-day alert is disabled.",
      localDate: date,
      archivedCompletedCount: archivedCompleted.length,
      taskCount: 0,
      results: [] as SendResult[]
    };
  }

  const tasks = await listIncompletePriorityTasks(date, { clinicId: options?.clinicId });
  if (tasks.length === 0) {
    return {
      skipped: false,
      reason: "No incomplete medium/high priority tasks.",
      localDate: date,
      archivedCompletedCount: archivedCompleted.length,
      taskCount: 0,
      results: [] as SendResult[]
    };
  }

  const currentMode = options?.modeOverride ?? notificationMode();
  const deliveries = await veterinarianDeliveries("dailyPriority", { clinicId: options?.clinicId });
  if (deliveries.length === 0) {
    return {
      skipped: true,
      reason: "All veterinarian daily medium/high alerts are opted out.",
      localDate: date,
      archivedCompletedCount: archivedCompleted.length,
      taskCount: tasks.length,
      results: [] as SendResult[]
    };
  }

  const results = await sendNotification({
    clinicId: options?.clinicId,
    clinicName,
    notificationType: "daily_priority_summary",
    subject: `${clinicName} medium/high tasks still open: ${tasks.length}`,
    html: dailyPrioritySummaryHtml(tasks, date, clinicName),
    text: dailyPrioritySummaryText(tasks, date, clinicName),
    idempotencyKeyBase: `daily-priority-summary/${date}`,
    modeOverride: currentMode,
    channelOverride: options?.channelOverride,
    deliveriesOverride: deliveries
  });

  return {
    skipped: false,
    localDate: date,
    archivedCompletedCount: archivedCompleted.length,
    taskCount: tasks.length,
    results
  };
}

export async function sendSmokeEmail(options?: {
  clinicId?: string | null;
  timeZone?: string;
  modeOverride?: NotificationMode;
  channelOverride?: NotificationChannel;
}) {
  const clinicName = await clinicNameFor(options?.clinicId);
  const { date } = localNotificationParts(options?.timeZone);
  const stamp = new Date().toISOString().slice(0, 16);
  const results = await sendNotification({
    clinicId: options?.clinicId,
    clinicName,
    notificationType: "smoke_test",
    subject: `${clinicName} notification smoke test`,
    html: smokeTestHtml(date, clinicName),
    text: `${clinicName} notification smoke test for ${date}.`,
    idempotencyKeyBase: `smoke-test/${stamp}`,
    modeOverride: options?.modeOverride,
    channelOverride: options?.channelOverride
  });
  return { localDate: date, results };
}

export async function sendAgentExampleEmail(options?: {
  clinicId?: string | null;
  timeZone?: string;
  modeOverride?: NotificationMode;
  recipients?: string[];
  subject?: string;
  message?: string;
  actorName?: string;
  cadence?: AgentEmailCadence;
  period?: string;
  postAppointmentDelayDays?: number;
  idempotencyKeyBase?: string;
}) {
  const clinicName = await clinicNameFor(options?.clinicId);
  const { date, month } = localNotificationParts(options?.timeZone);
  const requestedRecipients = Array.from(
    new Set((options?.recipients ?? []).map((recipient) => recipient.trim()).filter(Boolean))
  );
  const message = options?.message?.trim() || `This is an example email from the ${clinicName} agent.`;
  const subject = options?.subject?.trim() || `${clinicName} agent email`;
  const currentMode = options?.modeOverride ?? "test";
  const deliveryRecipients = currentMode === "test" ? [] : requestedRecipients;
  const cadence = options?.cadence ?? "once";
  const period = cadence === "monthly" ? options?.period ?? month : undefined;
  const postAppointmentDelayDays = options?.postAppointmentDelayDays ?? 7;
  const idempotencyKeyBase = options?.idempotencyKeyBase ??
    (cadence === "monthly"
      ? `agent-example-email/monthly/${period}`
      : cadence === "post_appointment"
        ? `agent-example-email/post-appointment/${date}/delay-${postAppointmentDelayDays}`
      : `agent-example-email/${randomUUID()}`);
  const results = await sendNotification({
    clinicId: options?.clinicId,
    clinicName,
    notificationType: "agent_example_email",
    subject,
    html: agentExampleHtml(message, options?.actorName, date, clinicName),
    text: agentExampleText(message, options?.actorName, date, clinicName),
    idempotencyKeyBase,
    modeOverride: currentMode,
    channelOverride: "email",
    deliveriesOverride: deliveryRecipients.length > 0 ? [{ channel: "email", recipients: deliveryRecipients }] : undefined
  });
  return {
    localDate: date,
    mode: currentMode,
    from: notificationEmailFrom(),
    recipients: deliveryRecipients,
    requestedRecipients,
    subject,
    cadence,
    postAppointmentDelayDays: cadence === "post_appointment" ? postAppointmentDelayDays : null,
    period: period ?? null,
    results
  };
}
