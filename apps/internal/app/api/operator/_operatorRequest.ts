import {
  checkPlatformOperatorAttemptLimit,
  getPlatformUsageSnapshot,
  recordPlatformOperatorAudit,
  setPlatformUsageAlertsEnabled
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  maskedPlatformOperatorEmail,
  platformOperatorConfigured,
  platformOperatorCookieName,
  platformOperatorPasscodeMatches,
  platformOperatorRequestAuthorized,
  platformOperatorRequestIdentity,
  platformOperatorSessionMaxAgeSeconds,
  platformOperatorSessionToken
} from "../../lib/server/platformOperatorAuth";
import { noStoreHeaders } from "../_apiResponse";

const sessionSchema = z.object({
  passcode: z.string().min(1).max(200)
});

const alertSettingsSchema = z.object({
  enabled: z.boolean()
});

function unavailableResponse() {
  return NextResponse.json(
    { error: "Private operator access is not configured." },
    { status: 503, headers: noStoreHeaders }
  );
}

function requirePlatformOperator(request: Request) {
  if (!platformOperatorConfigured()) return unavailableResponse();
  if (!platformOperatorRequestAuthorized(request)) {
    return NextResponse.json(
      { error: "Private operator access required." },
      { status: 401, headers: noStoreHeaders }
    );
  }
  return null;
}

export async function createPlatformOperatorSession(request: Request) {
  if (!platformOperatorConfigured()) return unavailableResponse();
  const parsed = sessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your private access code." },
      { status: 400, headers: noStoreHeaders }
    );
  }

  const identity = platformOperatorRequestIdentity(request);
  const limit = await checkPlatformOperatorAttemptLimit(identity);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many tries. Wait about ${limit.windowMinutes} minutes.` },
      { status: 429, headers: noStoreHeaders }
    );
  }

  const valid = platformOperatorPasscodeMatches(parsed.data.passcode);
  await recordPlatformOperatorAudit({
    action: valid ? "login_succeeded" : "login_failed",
    identity
  });
  if (!valid) {
    return NextResponse.json(
      { error: "That access code is not valid." },
      { status: 403, headers: noStoreHeaders }
    );
  }

  const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  response.cookies.set(platformOperatorCookieName, platformOperatorSessionToken(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: platformOperatorSessionMaxAgeSeconds
  });
  return response;
}

export function clearPlatformOperatorSession() {
  const response = NextResponse.json({ ok: true }, { headers: noStoreHeaders });
  response.cookies.set(platformOperatorCookieName, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
  return response;
}

export async function platformOperatorAnalyticsResponse(request: Request) {
  const unauthorized = requirePlatformOperator(request);
  if (unauthorized) return unauthorized;
  await recordPlatformOperatorAudit({ action: "dashboard_viewed" });
  const snapshot = await getPlatformUsageSnapshot();
  return NextResponse.json({
    ...snapshot,
    alert: {
      ...snapshot.alert,
      recipientConfigured: Boolean(process.env.PLATFORM_OPERATOR_EMAIL?.trim()),
      recipient: maskedPlatformOperatorEmail()
    }
  }, { headers: noStoreHeaders });
}

export async function updatePlatformOperatorSettingsResponse(request: Request) {
  const unauthorized = requirePlatformOperator(request);
  if (unauthorized) return unauthorized;
  const parsed = alertSettingsSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Choose whether low-usage email is on or off." },
      { status: 400, headers: noStoreHeaders }
    );
  }
  const settings = await setPlatformUsageAlertsEnabled(parsed.data.enabled);
  await recordPlatformOperatorAudit({
    action: "settings_updated",
    details: { usageAlertsEnabled: parsed.data.enabled }
  });
  return NextResponse.json({
    enabled: settings.usage_alerts_enabled,
    thresholdPercent: Number(settings.return_rate_threshold),
    state: settings.current_alert_state,
    lastSentAt: settings.last_alerted_at,
    updatedAt: settings.updated_at,
    recipientConfigured: Boolean(process.env.PLATFORM_OPERATOR_EMAIL?.trim()),
    recipient: maskedPlatformOperatorEmail()
  }, { headers: noStoreHeaders });
}
