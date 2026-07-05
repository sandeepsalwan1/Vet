import {
  deactivateRecipientProfile,
  getRecipientProfile,
  isEndOfDayAlertsEnabled,
  listRecipientProfiles,
  renameActorReferences,
  setEndOfDayAlertsEnabled,
  setRecipientProfile,
  type Actor,
  type ClinicContext,
  type RecipientProfile
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canAdmin, canUseNotificationSettings } from "../../lib/taskWorkflow";
import { doctorName, profileIdFromName } from "../../lib/veterinarianProfile";
import { logInfo, logWarn, noStoreHeaders } from "../_apiResponse";
import {
  actorSchema,
  authenticateActor,
  authenticateActorFromQuery,
  resolveClinicFromRequest
} from "../_shared";

const profileSchema = z.object({
  profileId: z.string().trim().max(80).optional(),
  displayName: z.string().trim().min(1).max(80),
  email: z.string().trim().max(160),
  phone: z.string().trim().max(80),
  passcode: z.string().trim().min(4).max(20),
  active: z.boolean().optional().default(true),
  emailOptIn: z.boolean(),
  smsOptIn: z.boolean(),
  escalationOptIn: z.boolean(),
  dailyPriorityOptIn: z.boolean()
});

const settingsPatchSchema = z.object({
  actor: actorSchema,
  endOfDayAlertsEnabled: z.boolean().optional(),
  profileName: z.string().trim().min(1).max(80).optional(),
  recipientProfile: profileSchema.optional(),
  deactivateProfileId: z.string().trim().max(80).optional()
});

type SettingsPatch = z.infer<typeof settingsPatchSchema>;
type SettingsAccessResult =
  | { actor: Actor; clinic: ClinicContext }
  | { response: NextResponse };
type SettingsPatchResult =
  | { actor: Actor; clinic: ClinicContext; patch: SettingsPatch }
  | { response: NextResponse };

const settingsAccessError = "Settings require Admin or Veterinarian.";

async function profilesForActor(actor: Actor, clinicId: string) {
  const profiles = await listRecipientProfiles({ clinicId, includeInactive: false });
  if (actor.role === "admin") return profiles;
  if (actor.role === "veterinarian" && actor.profileId) {
    return profiles.filter((profile) => profile.profileId === actor.profileId);
  }
  return [];
}

async function settingsPayloadForActor(actor: Actor, clinic: ClinicContext) {
  return {
    clinic,
    endOfDayAlertsEnabled: await isEndOfDayAlertsEnabled({ clinicId: clinic.clinicId }),
    recipientProfiles: await profilesForActor(actor, clinic.clinicId),
    canEditAllProfiles: actor.role === "admin",
    currentProfileId: actor.profileId ?? null
  };
}

async function settingsReadContext(request: Request): Promise<SettingsAccessResult> {
  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActorFromQuery(new URL(request.url), request, clinic);
  if ("response" in auth) {
    logWarn("settings_read_rejected", { reason: "unauthorized" });
    return { response: auth.response };
  }
  if (!canUseNotificationSettings(auth.actor.role)) {
    logWarn("settings_read_rejected", { reason: "unauthorized" });
    return {
      response: NextResponse.json({ error: settingsAccessError }, { status: 403 })
    };
  }
  return { actor: auth.actor, clinic };
}

async function settingsPatchContext(request: Request): Promise<SettingsPatchResult> {
  const parsed = settingsPatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    logWarn("settings_update_rejected", { reason: "unauthorized_or_invalid" });
    return {
      response: NextResponse.json({ error: settingsAccessError }, { status: 403 })
    };
  }

  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActor(parsed.data.actor, request, clinic);
  if ("response" in auth) {
    logWarn("settings_update_rejected", { reason: "unauthorized_or_invalid" });
    return { response: auth.response };
  }
  if (!canUseNotificationSettings(auth.actor.role)) {
    logWarn("settings_update_rejected", { reason: "unauthorized_or_invalid" });
    return {
      response: NextResponse.json({ error: settingsAccessError }, { status: 403 })
    };
  }
  return { actor: auth.actor, clinic, patch: parsed.data };
}

type SettingsUpdateResult =
  | {
      ok: true;
      payload: Omit<Awaited<ReturnType<typeof settingsPayloadForActor>>, "clinic">;
      logFields: {
        actorRole: Actor["role"];
        endOfDayAlertsEnabled: boolean;
        profileId?: string;
      };
    }
  | {
      ok: false;
      error: string;
      status: number;
    };

async function applySettingsPatch(
  actor: Actor,
  clinic: ClinicContext,
  patch: SettingsPatch
): Promise<SettingsUpdateResult> {
  let endOfDayAlertsEnabled = await isEndOfDayAlertsEnabled({ clinicId: clinic.clinicId });
  if (typeof patch.endOfDayAlertsEnabled === "boolean") {
    if (!canAdmin(actor.role)) {
      return { ok: false, error: "Only Admin can change the end-of-day alert.", status: 403 };
    }
    endOfDayAlertsEnabled = await setEndOfDayAlertsEnabled(
      patch.endOfDayAlertsEnabled,
      actor,
      { clinicId: clinic.clinicId }
    );
  }

  let updatedProfile: RecipientProfile | null = null;
  if (patch.profileName) {
    if (actor.role !== "veterinarian" || !actor.profileId) {
      return { ok: false, error: "Only veterinarians can change their own profile name.", status: 403 };
    }
    const existing = await getRecipientProfile(actor.profileId, { clinicId: clinic.clinicId });
    if (!existing) {
      return { ok: false, error: "Veterinarian profile not found.", status: 404 };
    }
    const nextName = doctorName(patch.profileName);
    updatedProfile = await setRecipientProfile(
      {
        ...existing,
        displayName: nextName
      },
      actor,
      { clinicId: clinic.clinicId }
    );
    await renameActorReferences({
      actor,
      oldName: actor.name,
      newName: nextName,
      clinicId: clinic.clinicId
    });
  }

  if (patch.recipientProfile) {
    const profileId =
      patch.recipientProfile.profileId ||
      profileIdFromName(patch.recipientProfile.displayName);
    const existing = await getRecipientProfile(profileId, { clinicId: clinic.clinicId });
    if (actor.role !== "admin" && actor.profileId !== profileId) {
      return { ok: false, error: "Veterinarians can only edit their own profile.", status: 403 };
    }
    if (actor.role !== "admin" && !existing) {
      return { ok: false, error: "Only Admin can add veterinarian profiles.", status: 403 };
    }
    const nextName = doctorName(patch.recipientProfile.displayName);
    updatedProfile = await setRecipientProfile(
      {
        ...(existing ?? patch.recipientProfile),
        ...patch.recipientProfile,
        displayName: nextName,
        profileId,
        passcode:
          actor.role === "admin"
            ? patch.recipientProfile.passcode
            : existing?.passcode ?? patch.recipientProfile.passcode,
        active:
          actor.role === "admin"
            ? patch.recipientProfile.active
            : existing?.active ?? true
      },
      actor,
      { clinicId: clinic.clinicId }
    );
    if (actor.role === "veterinarian" && existing && existing.displayName !== nextName) {
      await renameActorReferences({
        actor,
        oldName: existing.displayName,
        newName: nextName,
        clinicId: clinic.clinicId
      });
    }
  }

  if (patch.deactivateProfileId) {
    if (!canAdmin(actor.role)) {
      return { ok: false, error: "Only Admin can deactivate veterinarian profiles.", status: 403 };
    }
    updatedProfile = await deactivateRecipientProfile(
      patch.deactivateProfileId,
      actor,
      { clinicId: clinic.clinicId }
    );
  }

  return {
    ok: true,
    payload: {
      endOfDayAlertsEnabled,
      recipientProfiles: await profilesForActor(actor, clinic.clinicId),
      canEditAllProfiles: actor.role === "admin",
      currentProfileId: actor.profileId ?? null
    },
    logFields: {
      actorRole: actor.role,
      endOfDayAlertsEnabled,
      profileId: updatedProfile?.profileId
    }
  };
}

export async function settingsReadResponse(request: Request) {
  const context = await settingsReadContext(request);
  if ("response" in context) return context.response;
  return NextResponse.json(
    await settingsPayloadForActor(context.actor, context.clinic),
    { headers: noStoreHeaders }
  );
}

export async function settingsPatchResponse(request: Request) {
  const context = await settingsPatchContext(request);
  if ("response" in context) return context.response;
  const result = await applySettingsPatch(context.actor, context.clinic, context.patch);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  logInfo("settings_updated", result.logFields);
  return NextResponse.json(result.payload, { headers: noStoreHeaders });
}
