import {
  checkAuthAttemptLimit,
  getRecipientProfileByPasscode,
  recordAuthAttempt,
  resolveClinicForHostname,
  type Actor,
  type AppRole,
  type ClinicContext
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canManage } from "../lib/taskWorkflow";
import { logWarn } from "./_apiResponse";

const roleSchema = z.enum(["staff", "va", "task_adder", "veterinarian", "admin"]);
export const actorSchema = z.object({
  name: z.string().trim().max(80).optional().default(""),
  role: roleSchema,
  passcode: z.string().optional(),
  profileId: z.string().optional().nullable()
});

type RawActor = z.infer<typeof actorSchema>;
const passcodeHeader = "x-central-vet-passcode";

function configuredPasscode(value: string | undefined) {
  const passcode = value?.trim();
  return passcode || null;
}

function demoAccountsEnabled() {
  return process.env.DEMO_ACCOUNTS !== "disabled";
}

function vaPasscode() {
  return configuredPasscode(process.env.VET_ADMIN_PASSCODE);
}

function adminPasscode() {
  return configuredPasscode(process.env.VET_APP_ADMIN_PASSCODE || process.env.VET_VETERINARIAN_PASSCODE);
}

function veterinarianPasscode() {
  return configuredPasscode(process.env.VET_VETERINARIAN_PASSCODE);
}

function passcodeMatches(input: string | undefined, ...allowed: Array<string | null>) {
  const passcode = configuredPasscode(input);
  return Boolean(passcode && allowed.some((candidate) => candidate === passcode));
}

export async function resolveClinicFromRequest(request: Request): Promise<ClinicContext> {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || new URL(request.url).host;
  return resolveClinicForHostname(host);
}

async function normalizeActor(
  actor: z.infer<typeof actorSchema>,
  clinic: ClinicContext
): Promise<Actor | null> {
  const name = actor.name?.trim() || "";
  if (actor.role === "staff") {
    return name ? { name, role: "staff" } : null;
  }
  const vaCode = vaPasscode();
  const demoAdminCode = demoAccountsEnabled() ? "246810" : null;
  const demoVetCode = demoAccountsEnabled() ? "135790" : null;
  if ((actor.role === "va" || actor.role === "task_adder") && passcodeMatches(actor.passcode, vaCode, demoAdminCode)) {
    return name ? { name, role: "va" } : null;
  }
  const adminCode = adminPasscode();
  if (actor.role === "admin" && passcodeMatches(actor.passcode, adminCode, demoAdminCode)) {
    return name ? { name, role: "admin" } : null;
  }
  if (actor.role === "veterinarian") {
    const profile = await getRecipientProfileByPasscode(actor.passcode, {
      clinicId: clinic.clinicId
    });
    if (profile) {
      return {
        name: profile.displayName,
        role: "veterinarian",
        profileId: profile.profileId
      };
    }
    const vetCode = veterinarianPasscode();
    if (passcodeMatches(actor.passcode, vetCode, demoVetCode)) {
      return name ? { name, role: "veterinarian" } : null;
    }
  }
  return null;
}

function passcodeFromRequest(request: Request) {
  return request?.headers.get(passcodeHeader) || undefined;
}

function clientIdentity(request: Request, role: AppRole) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local";
  return [
    "passcode",
    role,
    ip,
    request.headers.get("user-agent") || "unknown"
  ].join("|");
}

export async function authenticateActor(
  actor: RawActor,
  request: Request,
  clinic?: ClinicContext
): Promise<{ actor: Actor } | { response: NextResponse }> {
  const clinicContext = clinic ?? await resolveClinicFromRequest(request);
  if (actor.role !== "staff") {
    const identity = clientIdentity(request, actor.role);
    const limit = await checkAuthAttemptLimit(identity, {
      clinicId: clinicContext.clinicId
    });
    if (!limit.allowed) {
      logWarn("auth_rate_limited", {
        actorRole: actor.role,
        failureCount: limit.failureCount,
        windowMinutes: limit.windowMinutes
      });
      return {
        response: NextResponse.json(
          {
            error: `Too many passcode tries. Wait about ${limit.windowMinutes} minutes, then try again.`
          },
          { status: 429 }
        )
      };
    }

    const normalized = await normalizeActor(actor, clinicContext);
    await recordAuthAttempt({
      clinicId: clinicContext.clinicId,
      identity,
      role: actor.role,
      success: Boolean(normalized)
    });
    if (!normalized) {
      return {
        response: NextResponse.json({ error: "Invalid passcode." }, { status: 403 })
      };
    }
    return { actor: normalized };
  }

  const normalized = await normalizeActor(actor, clinicContext);
  if (!normalized) {
    return {
      response: NextResponse.json({ error: "Invalid role or name." }, { status: 403 })
    };
  }
  return { actor: normalized };
}

export async function authenticateActorFromQuery(
  url: URL,
  request: Request,
  clinic?: ClinicContext
) {
  const role = roleSchema.safeParse(url.searchParams.get("role") ?? "staff");
  const name = url.searchParams.get("name") || "";
  const passcode = passcodeFromRequest(request);
  if (!role.success) {
    return {
      response: NextResponse.json({ error: "Invalid role or passcode." }, { status: 403 })
    };
  }
  return authenticateActor({ name, role: role.data, passcode }, request, clinic);
}

export async function requireManagerFromQuery(request: Request) {
  const url = new URL(request.url);
  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActorFromQuery(url, request, clinic);
  if ("response" in auth) return { url, clinic, response: auth.response };
  if (!canManage(auth.actor.role)) {
    return {
      url,
      clinic,
      response: NextResponse.json({ error: "Manager access required." }, { status: 403 })
    };
  }
  return { url, clinic, actor: auth.actor };
}

async function readBody(request: Request) {
  return await request.json().catch(() => ({}));
}

async function requireActorFromBody(request: Request) {
  const body = await readBody(request);
  const clinic = await resolveClinicFromRequest(request);
  const actorResult = actorSchema.safeParse(body.actor);
  if (!actorResult.success) {
    return {
      body,
      response: NextResponse.json({ error: "Internal agent routes require actor credentials." }, { status: 403 })
    };
  }
  const auth = await authenticateActor(actorResult.data, request, clinic);
  if ("response" in auth) {
    return { body, response: auth.response };
  }
  return { body, actor: auth.actor, clinic };
}

export async function requireManagerFromBody(request: Request) {
  const auth = await requireActorFromBody(request);
  if ("response" in auth) return auth;
  if (!canManage(auth.actor.role)) {
    logWarn("manager_route_rejected", { actorRole: auth.actor.role });
    return {
      body: auth.body,
      response: NextResponse.json({ error: "Manager access required." }, { status: 403 })
    };
  }
  return auth;
}
