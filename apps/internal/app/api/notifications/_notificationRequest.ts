import {
  sendAgentExampleEmail,
  sendDueClientJourneyMessages,
  sendDailyPrioritySummary,
  sendSmokeEmail
} from "@central-vet/notifications";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canManage } from "../../lib/taskWorkflow";
import { logInfo, logWarn } from "../_apiResponse";
import {
  actorSchema,
  authenticateActor,
  resolveClinicFromRequest
} from "../_shared";

export type NotificationMode = "disabled" | "test" | "production";

const smokeBodySchema = z.object({
  actor: actorSchema,
  mode: z.enum(["disabled", "test", "production"]).optional()
});

function notificationMode(value: string | null | undefined): NotificationMode {
  if (value === "test" || value === "production") return value;
  return "disabled";
}

function envList(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function requireCronAuthorization(request: Request, rejectedEvent: string) {
  if (cronAuthorized(request)) return null;
  logWarn(rejectedEvent, {
    reason: process.env.CRON_SECRET ? "invalid_secret" : "missing_cron_secret"
  });
  return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
}

async function smokeNotificationPayload(request: Request) {
  const body = smokeBodySchema.safeParse(await request.json());
  if (!body.success) {
    logWarn("smoke_notification_rejected", { reason: "unauthorized" });
    return {
      response: NextResponse.json({ error: "Authorized passcode required." }, { status: 403 })
    };
  }

  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActor(body.data.actor, request, clinic);
  if ("response" in auth) {
    logWarn("smoke_notification_rejected", { reason: "unauthorized" });
    return { response: auth.response };
  }
  if (!canManage(auth.actor.role)) {
    logWarn("smoke_notification_rejected", {
      reason: "insufficient_role",
      actorRole: auth.actor.role
    });
    return {
      response: NextResponse.json({ error: "Authorized passcode required." }, { status: 403 })
    };
  }

  const result = await sendSmokeEmail({
    clinicId: clinic.clinicId,
    timeZone: clinic.timeZone,
    modeOverride: body.data.mode
  });
  logInfo("smoke_notification_checked", {
    mode: body.data.mode || "env",
    resultCount: result.results.length
  });
  return { result };
}

export async function dailyPrioritySummaryResponse(request: Request) {
  const unauthorized = requireCronAuthorization(request, "daily_priority_summary_rejected");
  if (unauthorized) return unauthorized;
  const clinic = await resolveClinicFromRequest(request);
  const result = await sendDailyPrioritySummary({
    clinicId: clinic.clinicId,
    timeZone: clinic.timeZone
  });
  logInfo("daily_priority_summary_checked", {
    skipped: result.skipped,
    taskCount: result.taskCount,
    resultCount: result.results.length
  });
  return NextResponse.json(result);
}

export async function clientJourneyNotificationsResponse(request: Request) {
  const unauthorized = requireCronAuthorization(request, "client_journey_notifications_rejected");
  if (unauthorized) return unauthorized;
  const clinic = await resolveClinicFromRequest(request);
  const result = await sendDueClientJourneyMessages({ clinicId: clinic.clinicId });
  logInfo("client_journey_notifications_checked", result);
  return NextResponse.json(result);
}

export async function monthlyAgentEmailResponse(request: Request) {
  const unauthorized = requireCronAuthorization(request, "monthly_agent_email_rejected");
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const clinic = await resolveClinicFromRequest(request);
  const mode = notificationMode(
    url.searchParams.get("mode") ||
    process.env.MONTHLY_AGENT_EMAIL_MODE ||
    process.env.NOTIFICATION_MODE
  );
  const period = url.searchParams.get("period") || undefined;
  if (period && !/^\d{4}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "period must be YYYY-MM." }, { status: 400 });
  }

  const result = await sendAgentExampleEmail({
    clinicId: clinic.clinicId,
    timeZone: clinic.timeZone,
    modeOverride: mode,
    cadence: "monthly",
    period,
    recipients: envList(process.env.MONTHLY_AGENT_EMAIL_RECIPIENTS),
    subject: `${clinic.name} monthly agent email`,
    message: process.env.MONTHLY_AGENT_EMAIL_MESSAGE ||
      "This is the monthly VetAgent email path check."
  });

  logInfo("monthly_agent_email_checked", {
    mode,
    resultCount: result.results.length
  });
  return NextResponse.json({ ok: true, result });
}

export async function smokeNotificationResponse(request: Request) {
  const payload = await smokeNotificationPayload(request);
  if ("response" in payload) return payload.response;
  return NextResponse.json(payload.result);
}
