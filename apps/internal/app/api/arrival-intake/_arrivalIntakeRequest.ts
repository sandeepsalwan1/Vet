import {
  checkoutArrivalRoom,
  createArrivalException,
  getArrivalSettings,
  listArrivalDesk,
  matchArrivalIdentity,
  submitMatchedArrival,
  updateArrivalSettings,
  updateClinicRoom,
  type Actor
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { z } from "zod";
import { canAdmin } from "../../lib/taskWorkflow";
import { noStoreHeaders } from "../_apiResponse";
import {
  authenticateActor,
  authenticateActorFromQuery,
  actorSchema,
  resolveClinicFromRequest
} from "../_shared";

const questionnaireSchema = z.object({
  visitReasons: z.array(z.string().trim().min(1)).min(1).max(8),
  sickSignsLabel: z.string().trim().min(1).max(120),
  sickSigns: z.array(z.string().trim().min(1)).min(1).max(12),
  specialConcernsLabel: z.string().trim().min(1).max(120),
  vaccineFeelingLabel: z.string().trim().min(1).max(160),
  surgeryAteLabel: z.string().trim().min(1).max(160),
  surgeryFeelingLabel: z.string().trim().min(1).max(160),
  dentalConcernLabel: z.string().trim().min(1).max(160),
  routineConcernLabel: z.string().trim().min(1).max(160)
});

const identitySchema = z.object({
  clientName: z.string().trim().max(120).optional().nullable(),
  lastName: z.string().trim().max(80).optional().nullable(),
  clientPhone: z.string().trim().max(40).optional().nullable(),
  petName: z.string().trim().max(80).optional().nullable()
});

const publicArrivalActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("match"),
    identity: identitySchema
  }),
  z.object({
    action: z.literal("submit"),
    identity: identitySchema,
    visitReason: z.string().trim().min(1).max(80),
    answers: z.record(z.string(), z.unknown()).default({})
  })
]);

const arrivalDeskPatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("room"),
    actor: actorSchema,
    roomId: z.string().uuid(),
    state: z.enum(["open", "occupied", "closed", "cleaning"])
  }),
  z.object({
    action: z.literal("checkout"),
    actor: actorSchema,
    arrivalId: z.string().uuid()
  }),
  z.object({
    action: z.literal("settings"),
    actor: actorSchema,
    roomAssignmentEnabled: z.boolean(),
    questionnaire: questionnaireSchema
  })
]);

type PublicArrivalAction = z.infer<typeof publicArrivalActionSchema>;
type ArrivalDeskPatch = z.infer<typeof arrivalDeskPatchSchema>;

type RoutePayload = {
  body: Record<string, unknown>;
  status?: number;
};

const exceptionMessage = "Front desk help is ready. We could not safely match one appointment from that info.";

async function publicArrivalSettings(clinicId: string) {
  return {
    settings: await getArrivalSettings({ clinicId })
  };
}

async function arrivalDeskPayload(clinicId: string) {
  return listArrivalDesk({ clinicId });
}

async function createException(clinicId: string, identity: PublicArrivalAction["identity"], reason?: string) {
  return createArrivalException({
    clinicId,
    clientName: identity.clientName,
    lastName: identity.lastName,
    clientPhone: identity.clientPhone,
    petName: identity.petName,
    reason
  });
}

async function applyPublicArrivalAction(
  clinicId: string,
  action: PublicArrivalAction
): Promise<RoutePayload> {
  const identity = action.identity;
  const match = await matchArrivalIdentity({
    clinicId,
    clientName: identity.clientName,
    lastName: identity.lastName,
    clientPhone: identity.clientPhone,
    petName: identity.petName
  });

  if (action.action === "match") {
    if (!match) {
      return {
        body: {
          matched: false,
          message: exceptionMessage,
          exception: await createException(clinicId, identity)
        }
      };
    }
    return { body: { matched: true, match } };
  }

  if (!match) {
    return {
      status: 409,
      body: {
        matched: false,
        message: exceptionMessage,
        exception: await createException(
          clinicId,
          identity,
          "Questionnaire submitted without a safe appointment match."
        )
      }
    };
  }

  const arrival = await submitMatchedArrival({
    clinicId,
    match,
    visitReason: action.visitReason,
    answers: action.answers as Record<string, unknown>
  });
  return {
    status: 201,
    body: {
      matched: true,
      arrival,
      message: arrival.roomName
        ? `You are checked in. Please go to ${arrival.roomName}.`
        : "You are checked in. The front desk will direct you."
    }
  };
}

async function applyArrivalDeskPatch(
  clinicId: string,
  actor: Actor,
  patch: ArrivalDeskPatch
): Promise<RoutePayload | { error: string; status: number }> {
  if (patch.action === "settings" && !canAdmin(actor.role)) {
    return { error: "Admin required.", status: 403 };
  }

  if (patch.action === "room") {
    return {
      body: {
        room: await updateClinicRoom({
          clinicId,
          roomId: patch.roomId,
          state: patch.state
        })
      }
    };
  }

  if (patch.action === "checkout") {
    return {
      body: {
        room: await checkoutArrivalRoom({
          clinicId,
          arrivalId: patch.arrivalId
        })
      }
    };
  }

  return {
    body: {
      settings: await updateArrivalSettings({
        clinicId,
        roomAssignmentEnabled: patch.roomAssignmentEnabled,
        questionnaire: patch.questionnaire
      })
    }
  };
}

export async function arrivalIntakeGetResponse(request: Request) {
  const url = new URL(request.url);
  const clinic = await resolveClinicFromRequest(request);
  if (!url.searchParams.has("role")) {
    return NextResponse.json(await publicArrivalSettings(clinic.clinicId), { headers: noStoreHeaders });
  }

  const auth = await authenticateActorFromQuery(url, request, clinic);
  if ("response" in auth) return auth.response;
  return NextResponse.json(await arrivalDeskPayload(clinic.clinicId), { headers: noStoreHeaders });
}

export async function publicArrivalActionResponse(request: Request) {
  const clinic = await resolveClinicFromRequest(request);
  const body = publicArrivalActionSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Use the check-in form." }, { status: 400 });
  }
  const result = await applyPublicArrivalAction(clinic.clinicId, body.data);
  return NextResponse.json(result.body, { status: result.status });
}

export async function arrivalDeskPatchResponse(request: Request) {
  const clinic = await resolveClinicFromRequest(request);
  const body = arrivalDeskPatchSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "Invalid arrival update." }, { status: 400 });
  }

  const auth = await authenticateActor(body.data.actor, request, clinic);
  if ("response" in auth) return auth.response;

  const result = await applyArrivalDeskPatch(clinic.clinicId, auth.actor, body.data);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.body, { status: result.status });
}
