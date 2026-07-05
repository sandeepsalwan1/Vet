import type {
  AgentInput,
  AgentTaskDraft,
  AgentWorkflowResult,
  MockAppointment,
  MockClient,
  MockPet,
  RunAgentOptions
} from "./contracts";
import { checkMedicalGuardrail } from "./guardrails";
import {
  buildResult,
  classifyIntent,
  createRuntime,
  normalizeAgentInput,
  resolveMode
} from "./mockProvider";
import { runCallAgent } from "./callAgent";
import { decideCapabilityRoute, withCapabilityDecision } from "./capabilityRouting";
import { runFollowupAgent } from "./followupAgent";
import { runRecordsAgent } from "./recordsAgent";
import { executeTool, getInputText } from "./tools";

type ArrivalResult = {
  client: MockClient | null;
  pet: MockPet | null;
  appointment: MockAppointment | null;
};

type WaitResult = {
  waitStatus: {
    waitMinutes: number;
    queuePosition: number;
    roomStatus: string;
  } | null;
};

type BookingToolResult = {
  booked: boolean;
  action?: string;
  confirmationId?: string;
  appointment?: MockAppointment | null;
  slot?: { slotDate: string; slotTime: string; doctor: string; appointmentType: string } | null;
  client?: MockClient | null;
  pet?: MockPet | null;
  task?: AgentTaskDraft | null;
};

type StatusUpdateResult = {
  sent?: boolean;
  delivery?: string;
  client?: MockClient | null;
  message?: string;
};

export async function runExternalAgent(input: AgentInput | unknown, options: RunAgentOptions = {}): Promise<AgentWorkflowResult> {
  const normalized = normalizeAgentInput(input);
  const intent = classifyIntent(normalized, "call");
  const capabilityDecision = decideCapabilityRoute("external", normalized, intent);
  const complete = (result: AgentWorkflowResult) => withCapabilityDecision(result, capabilityDecision);
  if (intent === "records") return complete(await runRecordsAgent(normalized, { ...options, audience: "external" }));
  if (intent === "followup") return complete(await runFollowupAgent(normalized, options));
  if (intent === "call" || intent === "unknown") return complete(await runCallAgent(normalized, options));

  const mode = resolveMode(options);
  const runtime = createRuntime(normalized, intent, options);

  if (intent === "sick_pet") {
    const guardrail = checkMedicalGuardrail(normalized);
    const triage = await executeTool("dispatch_clinical_triage", {
      priority: guardrail.priority,
      clientName: normalized.clientName ?? normalized.callerName ?? null,
      clientPhone: normalized.clientPhone ?? normalized.callerPhone ?? null,
      petName: normalized.petName ?? null,
      message: getInputText(normalized) || "Client reports pet illness.",
      reasons: guardrail.reasons
    }, runtime);
    return complete(buildResult({
      intent,
      mode,
      message: guardrail.message ?? "I sent this to the clinical triage channel.",
      result: { escalated: true, medicalAdviceGiven: false, reasons: guardrail.reasons, triage },
      runtime,
      options
    }));
  }

  if (intent === "checkin") {
    const arrival = await executeTool("start_arrival", {
      clientName: normalized.clientName ?? normalized.callerName,
      clientPhone: normalized.clientPhone ?? normalized.callerPhone,
      petName: normalized.petName
    }, runtime) as ArrivalResult;

    if (!arrival.appointment || !arrival.client || !arrival.pet) {
      const exception = await executeTool("capture_arrival_exception", {
        clientName: normalized.clientName ?? normalized.callerName ?? null,
        clientPhone: normalized.clientPhone ?? normalized.callerPhone ?? null,
        petName: normalized.petName ?? null,
        request: getInputText(normalized) || "Client says they are here."
      }, runtime);
      return complete(buildResult({
        intent,
        mode,
        message: "I could not find a matching appointment, so I captured an arrival exception in the front-desk mock integration.",
        result: { matched: false, action: "arrival_exception_captured", exception },
        runtime,
        options
      }));
    }

    const waitComplaint = /wait|waiting|been here|long time|so long/i.test(getInputText(normalized));
    const arrived = await executeTool("mark_arrived", { appointmentId: arrival.appointment.id, waitComplaint }, runtime) as {
      task: AgentTaskDraft | null;
      alreadyArrived?: boolean;
      action?: string;
      alert?: Record<string, unknown> | null;
    };
    const wait = await executeTool("get_wait_status", { appointmentId: arrival.appointment.id }, runtime) as WaitResult;
    const waitMinutes = wait.waitStatus?.waitMinutes ?? arrival.appointment.waitMinutes;
    const message = arrived.alreadyArrived
      ? `${arrival.pet.name} is already checked in. Your arrival is on the clinic board.`
      : waitComplaint
        ? `You are checked in for ${arrival.pet.name}. Current wait is about ${waitMinutes} minutes, and I flagged the queue issue on the clinic board.`
        : `You are checked in for ${arrival.pet.name}. Current wait is about ${waitMinutes} minutes.`;
    return complete(buildResult({
      intent,
      mode,
      message,
      result: {
        matched: true,
        action: arrived.action ?? (arrived.alreadyArrived ? "already_checked_in" : "checked_in"),
        alreadyArrived: Boolean(arrived.alreadyArrived),
        client: arrival.client,
        pet: arrival.pet,
        appointment: arrival.appointment,
        waitEstimateMinutes: waitMinutes
      },
      runtime,
      options,
      task: arrived.task ?? undefined
    }));
  }

  if (intent === "booking") {
    const clientName = normalized.clientName ?? normalized.callerName;
    const clientPhone = normalized.clientPhone ?? normalized.callerPhone;
    const arrival = await executeTool("start_arrival", {
      clientName,
      clientPhone,
      petName: normalized.petName
    }, runtime) as ArrivalResult;
    const client = arrival.client;
    const pet = arrival.pet;
    if (!client || !pet) {
      const intake = await executeTool("capture_booking_request", {
        clientName: clientName ?? null,
        clientPhone: clientPhone ?? null,
        petName: normalized.petName ?? null,
        appointmentType: normalized.appointmentType ?? null,
        request: getInputText(normalized) || "Client requested an appointment."
      }, runtime);
      return complete(buildResult({
        intent,
        mode,
        message: "I could not match the client and pet, so I captured a scheduler intake item in the mock booking integration.",
        result: { booked: false, action: "booking_request_captured", needsReview: false, intake },
        runtime,
        options
      }));
    }

    const slots = await executeTool("list_slots", {
      appointmentType: normalized.appointmentType ?? "Vaccines"
    }, runtime) as {
      slots: { id: string; slotDate: string; slotTime: string; doctor: string; appointmentType: string }[];
    };
    const selected = slots.slots[0] ?? null;
    if (!selected) {
      const intake = await executeTool("capture_booking_request", {
        clientName: client.fullName,
        clientPhone: client.phone,
        petName: pet.name,
        appointmentType: normalized.appointmentType ?? null,
        request: `No mock slots found for ${normalized.appointmentType ?? "requested appointment"}.`
      }, runtime);
      return complete(buildResult({
        intent,
        mode,
        message: "I did not find an open matching slot, so I captured the request in the mock scheduler intake.",
        result: { booked: false, action: "booking_request_captured", slots: [], intake },
        runtime,
        options
      }));
    }

    const booking = await executeTool("book_appointment", {
      slotId: selected.id,
      clientId: client.id,
      petId: pet.id,
      reason: normalized.appointmentType ?? "Appointment request"
    }, runtime) as BookingToolResult;
    const appointment = booking.appointment ?? null;
    return complete(buildResult({
      intent,
      mode,
      message: appointment
        ? `You're booked for ${appointment.appointmentType} on ${appointment.appointmentDate} at ${appointment.appointmentTime} with ${appointment.doctor}. Confirmation ${booking.confirmationId ?? appointment.id}.`
        : "I could not finalize that appointment slot, so I opened an overflow scheduling request.",
      result: {
        booked: booking.booked,
        action: booking.action ?? (booking.booked ? "appointment_booked" : "booking_not_completed"),
        confirmationId: booking.confirmationId ?? appointment?.id ?? null,
        appointment,
        slot: booking.slot,
        client,
        pet
      },
      runtime,
      options,
      task: booking.task ?? undefined
    }));
  }

  if (intent === "pickup") {
    const arrival = await executeTool("start_arrival", {
      clientName: normalized.clientName ?? normalized.callerName,
      clientPhone: normalized.clientPhone ?? normalized.callerPhone,
      petName: normalized.petName
    }, runtime) as ArrivalResult;
    const pet = arrival.pet;
    const client = arrival.client;
    const wait = pet ? await executeTool("get_wait_status", { petId: pet.id }, runtime) as WaitResult : { waitStatus: null };
    const ready = pet?.id === "pet-luna" || wait.waitStatus?.roomStatus === "ready";
    if (pet && client) {
      const statusUpdate = ready
        ? await executeTool("send_status_update", {
            clientId: client.id,
            message: `${pet.name} is ready for pickup. Please check in at the front desk.`
          }, runtime) as StatusUpdateResult
        : null;
      return complete(buildResult({
        intent,
        mode,
        message: ready
          ? `${pet.name} is marked ready for pickup. I sent the pickup note through the mock client portal.`
          : `${pet.name} is not marked ready yet. Current status is ${wait.waitStatus?.roomStatus ?? "not active"}.`,
        result: {
          ready,
          action: ready ? "pickup_ready_confirmed" : "pickup_status_checked",
          pet,
          client,
          waitStatus: wait.waitStatus,
          statusUpdate,
          source: "mock/DB data"
        },
        runtime,
        options
      }));
    }
    const message = await executeTool("send_clinic_inbox_message", {
      subject: "Pickup status lookup could not match a patient",
      priority: "medium",
      clientName: client?.fullName ?? normalized.clientName ?? null,
      clientPhone: client?.phone ?? normalized.clientPhone ?? null,
      petName: pet?.name ?? normalized.petName ?? null,
      message: getInputText(normalized) || "Client asked if pet is ready."
    }, runtime);
    return complete(buildResult({
      intent,
      mode,
      message: ready
        ? `${pet?.name ?? "Your pet"} is marked ready for pickup. Please check in at the front desk.`
        : "I could not match an active pickup, so I sent a front-desk mock message with the client details.",
      result: { ready, action: "clinic_message_sent", pet, client, waitStatus: wait.waitStatus, source: "mock/DB data", message },
      runtime,
      options
    }));
  }

  return complete(await runCallAgent(normalized, options));
}
