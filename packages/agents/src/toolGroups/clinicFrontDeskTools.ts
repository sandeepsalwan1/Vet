import { z } from "zod";
import { mockDeliveryChannels } from "../agentVocabulary";
import {
  clientFor,
  defineTool,
  id,
  petFor,
  recordEvent
} from "../toolCore";

export const clinicFrontDeskTools = {
  mark_arrived: defineTool({
    description: "Mark an appointment arrived. Set waitComplaint when the client reports waiting too long.",
    parameters: z.object({
      appointmentId: z.string(),
      waitComplaint: z.boolean().optional()
    }),
    execute: async (args, runtime) => {
      const appointment = runtime.data.appointments.find((candidate) => candidate.id === args.appointmentId) ?? null;
      const client = appointment ? clientFor(runtime.data, appointment.clientId) : null;
      const pet = appointment ? petFor(runtime.data, appointment.petId) : null;
      if (!appointment || !client || !pet) return { arrived: false };
      if (appointment.status === "arrived") {
        recordEvent(runtime, {
          eventType: "already_arrived",
          title: `${pet.name} was already checked in`,
          detail: "No duplicate arrival task was created.",
          metadata: { appointmentId: appointment.id, action: "already_checked_in" }
        });
        return { arrived: true, action: "already_checked_in", alreadyArrived: true, appointment, client, pet, task: null };
      }
      const needsStaffAttention = Boolean(args.waitComplaint || appointment.waitMinutes >= 30);
      const alert = needsStaffAttention
        ? {
            action: "wait_concern_dispatched",
            status: "sent",
            delivery: mockDeliveryChannels.frontDeskConsole,
            alertId: id("wait-alert", `${appointment.id}-${pet.id}-${appointment.waitMinutes}`),
            priority: "high",
            clientName: client.fullName,
            clientPhone: client.phone,
            petName: pet.name,
            waitMinutes: appointment.waitMinutes,
            notes: appointment.notes ?? null,
            sentAt: runtime.now.toISOString()
          }
        : null;
      if (alert) {
        recordEvent(runtime, {
          eventType: "wait_concern_dispatched",
          title: "Wait concern alert sent",
          detail: `${pet.name} arrived and reports a wait concern; wait estimate ${appointment.waitMinutes} minutes.`,
          metadata: alert
        });
      }
      recordEvent(runtime, {
        eventType: "arrived",
        title: `${pet.name} checked in`,
        detail: `${client.fullName} matched to ${appointment.appointmentTime} with ${appointment.doctor}.`,
        metadata: {
          appointmentId: appointment.id,
          alertId: alert?.alertId ?? null,
          waitMinutes: appointment.waitMinutes,
          action: "checked_in"
        }
      });
      return { arrived: true, action: "checked_in", appointment: { ...appointment, status: "arrived" }, client, pet, alert, task: null };
    }
  }),
  send_status_update: defineTool({
    description: "Send a mock client portal status update; future adapter can replace this with the real portal/SMS integration.",
    parameters: z.object({
      clientId: z.string(),
      message: z.string()
    }),
    execute: async (args, runtime) => {
      const client = clientFor(runtime.data, args.clientId);
      recordEvent(runtime, {
        eventType: "status_update_sent",
        title: "Client portal update sent",
        detail: args.message,
        metadata: { clientId: args.clientId, delivery: mockDeliveryChannels.clientPortal, action: "status_update_sent" }
      });
      return { sent: true, delivery: mockDeliveryChannels.clientPortal, client, message: args.message };
    }
  }),
  capture_arrival_exception: defineTool({
    description: "Capture an arrival/check-in exception as a mock front-desk integration event, without creating a review task.",
    parameters: z.object({
      clientName: z.string().optional().nullable(),
      clientPhone: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      request: z.string()
    }),
    execute: async (args, runtime) => {
      const exception = {
        action: "arrival_exception_captured",
        status: "captured",
        delivery: mockDeliveryChannels.frontDeskConsole,
        confirmationId: id("arrival-exception", `${args.clientName ?? "client"}-${args.petName ?? "pet"}-${args.request}`),
        clientName: args.clientName ?? null,
        clientPhone: args.clientPhone ?? null,
        petName: args.petName ?? null,
        request: args.request,
        capturedAt: runtime.now.toISOString()
      };
      recordEvent(runtime, {
        eventType: "arrival_exception_captured",
        title: "Arrival exception captured",
        detail: args.request,
        metadata: exception
      });
      return { exception };
    }
  }),
  send_clinic_inbox_message: defineTool({
    description: "Send a mock clinic inbox/front-desk message for unresolved client requests, without creating a task.",
    parameters: z.object({
      subject: z.string(),
      message: z.string(),
      priority: z.enum(["low", "medium", "high"]).optional(),
      clientName: z.string().optional().nullable(),
      clientPhone: z.string().optional().nullable(),
      petName: z.string().optional().nullable()
    }),
    execute: async (args, runtime) => {
      const message = {
        action: "clinic_message_sent",
        status: "sent",
        delivery: mockDeliveryChannels.clinicInbox,
        messageId: id("clinic-message", `${args.subject}-${args.clientName ?? "client"}-${args.petName ?? "pet"}-${args.message}`),
        priority: args.priority ?? "medium",
        clientName: args.clientName ?? null,
        clientPhone: args.clientPhone ?? null,
        petName: args.petName ?? null,
        subject: args.subject,
        body: args.message,
        sentAt: runtime.now.toISOString()
      };
      recordEvent(runtime, {
        eventType: "clinic_message_sent",
        title: args.subject,
        detail: args.message,
        metadata: message
      });
      return { message };
    }
  }),
  dispatch_clinical_triage: defineTool({
    description: "Dispatch a mock urgent clinical triage alert without giving medical advice or creating a review task.",
    parameters: z.object({
      clientName: z.string().optional().nullable(),
      clientPhone: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      message: z.string(),
      priority: z.enum(["low", "medium", "high"]),
      reasons: z.array(z.string()).optional()
    }),
    execute: async (args, runtime) => {
      const alert = {
        action: "clinical_triage_dispatched",
        status: "sent",
        delivery: mockDeliveryChannels.clinicalTriage,
        alertId: id("clinical-alert", `${args.clientName ?? "client"}-${args.petName ?? "pet"}-${args.message}`),
        priority: args.priority,
        clientName: args.clientName ?? null,
        clientPhone: args.clientPhone ?? null,
        petName: args.petName ?? null,
        message: args.message,
        reasons: args.reasons ?? [],
        medicalAdviceGiven: false,
        sentAt: runtime.now.toISOString()
      };
      recordEvent(runtime, {
        eventType: "clinical_triage_dispatched",
        title: "Clinical triage alert sent",
        detail: args.message,
        metadata: alert
      });
      return { alert, medicalAdviceGiven: false };
    }
  })
};
