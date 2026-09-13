import {
  archiveCompletedTasksBefore,
  isEndOfDayAlertsEnabled,
  listIncompletePriorityTasks,
  type Task
} from "@central-vet/db";
import {
  dailyPrioritySummaryHtml,
  dailyPrioritySummaryText,
  escalationHtml,
  escalationText
} from "./notificationContent";
import {
  localNotificationParts,
  notificationMode,
  veterinarianDeliveries,
  type NotificationChannel,
  type NotificationMode
} from "./notificationDelivery";
import { clinicNameFor } from "./notificationClinic";
import { sendNotification, type SendResult } from "./notificationSend";

const systemActor = { name: "System", role: "admin" as const };

export async function sendEscalationAlert(task: Task, options?: {
  modeOverride?: NotificationMode;
}) {
  const deliveries = await veterinarianDeliveries("escalation", {
    clinicId: task.clinicId
  });
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
    subject:
      `${clinicName} escalated task: ` +
      (task.petName || task.clientName || "Task"),
    html: escalationHtml(task, clinicName),
    text: escalationText(task, clinicName),
    idempotencyKeyBase:
      `escalation/${task.id}/${task.escalatedAt || "new"}`,
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
  const timeZone = options?.timeZone ||
    process.env.APP_TIME_ZONE ||
    process.env.TZ ||
    "America/Los_Angeles";
  const clinicName = await clinicNameFor(options?.clinicId);
  const { date, hour } = localNotificationParts(timeZone);
  const requiredHour = Number(
    process.env.DAILY_PRIORITY_SUMMARY_HOUR ?? 18
  );
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
  if (
    !options?.force &&
    !(await isEndOfDayAlertsEnabled({ clinicId: options?.clinicId }))
  ) {
    return {
      skipped: true,
      reason: "End-of-day alert is disabled.",
      localDate: date,
      archivedCompletedCount: archivedCompleted.length,
      taskCount: 0,
      results: [] as SendResult[]
    };
  }

  const tasks = await listIncompletePriorityTasks(date, {
    clinicId: options?.clinicId
  });
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
  const deliveries = await veterinarianDeliveries("dailyPriority", {
    clinicId: options?.clinicId
  });
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
