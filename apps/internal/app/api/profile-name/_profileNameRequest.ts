import {
  getRecipientProfile,
  listRecipientProfiles,
  renameActorReferences,
  setRecipientProfile,
  type Actor
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { doctorName } from "../../lib/veterinarianProfile";
import { logInfo, logWarn, noStoreHeaders } from "../_apiResponse";
import { actorSchema, authenticateActor, resolveClinicFromRequest } from "../_shared";

const profileNameBodySchema = z.object({
  actor: actorSchema,
  name: z.string().trim().min(1).max(80)
});

type ProfileNameUpdateContext =
  | { actor: Actor; clinicId: string; name: string }
  | { response: NextResponse };

async function profilePayload(profileId: string | null | undefined, clinicId: string) {
  if (!profileId) return {};
  const profiles = await listRecipientProfiles({ clinicId, includeInactive: true });
  return {
    recipientProfiles: profiles.filter((profile) => profile.profileId === profileId),
    currentProfileId: profileId
  };
}

async function applyProfileNameUpdate(args: {
  actor: Actor;
  clinicId: string;
  name: string;
}) {
  const nextName = args.actor.role === "veterinarian"
    ? doctorName(args.name)
    : args.name;

  if (args.actor.role === "veterinarian" && args.actor.profileId) {
    const existing = await getRecipientProfile(args.actor.profileId, { clinicId: args.clinicId });
    if (!existing) {
      return { ok: false as const, error: "Veterinarian profile not found.", status: 404 };
    }
    await setRecipientProfile(
      { ...existing, displayName: nextName },
      args.actor,
      { clinicId: args.clinicId }
    );
  }

  const rename = await renameActorReferences({
    actor: args.actor,
    oldName: args.actor.name,
    newName: nextName,
    clinicId: args.clinicId
  });

  return {
    ok: true as const,
    body: {
      actor: { ...args.actor, name: nextName },
      previousName: args.actor.name,
      rename,
      ...(await profilePayload(args.actor.profileId, args.clinicId))
    },
    logFields: {
      actorRole: args.actor.role,
      tasksUpdated: rename.tasksUpdated,
      eventsUpdated: rename.eventsUpdated
    }
  };
}

async function profileNameUpdateContext(request: Request): Promise<ProfileNameUpdateContext> {
  const parsed = profileNameBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    logWarn("profile_name_rejected", { reason: "invalid_payload" });
    return {
      response: NextResponse.json({ error: "Enter a valid name." }, { status: 400 })
    };
  }

  const clinic = await resolveClinicFromRequest(request);
  const auth = await authenticateActor(parsed.data.actor, request, clinic);
  if ("response" in auth) {
    logWarn("profile_name_rejected", { reason: "unauthorized", actorRole: parsed.data.actor.role });
    return { response: auth.response };
  }

  return {
    actor: auth.actor,
    clinicId: clinic.clinicId,
    name: parsed.data.name
  };
}

export async function profileNameUpdateResponse(request: Request) {
  const context = await profileNameUpdateContext(request);
  if ("response" in context) return context.response;
  const result = await applyProfileNameUpdate({
    actor: context.actor,
    name: context.name,
    clinicId: context.clinicId
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  logInfo("profile_name_updated", result.logFields);
  return NextResponse.json(result.body, { headers: noStoreHeaders });
}
