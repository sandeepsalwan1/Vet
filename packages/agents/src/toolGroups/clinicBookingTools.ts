import { z } from "zod";
import { mockDeliveryChannels } from "../agentVocabulary";
import {
  defineTool,
  id,
  recordEvent,
  type ToolRuntime
} from "../toolCore";

async function bookAppointment(args: {
  slotId: string;
  clientId: string;
  petId: string;
  reason?: string;
}, runtime: ToolRuntime) {
  const result = await runtime.adapters.appointments.bookAppointment(args);
  if (result.booked && result.appointment && result.slot && result.client && result.pet) {
    recordEvent(runtime, {
      eventType: "appointment_booked",
      title: "Appointment booked",
      detail: `${result.pet.name} booked for ${result.slot.appointmentType} on ${result.slot.slotDate} at ${result.slot.slotTime}.`,
      metadata: {
        slotId: result.slot.id,
        appointmentId: result.appointment.id,
        clientId: result.client.id,
        petId: result.pet.id,
        action: "appointment_booked"
      }
    });
  }
  return result;
}

export const clinicBookingTools = {
  book_appointment: defineTool({
    description: "Book an available appointment slot for a matched client and pet.",
    parameters: z.object({
      slotId: z.string(),
      clientId: z.string(),
      petId: z.string(),
      reason: z.string().optional()
    }),
    execute: async (args, runtime) => bookAppointment(args, runtime)
  }),
  capture_booking_request: defineTool({
    description: "Capture an appointment request in a mock scheduler intake, without creating a pending review task.",
    parameters: z.object({
      clientName: z.string().optional().nullable(),
      clientPhone: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      appointmentType: z.string().optional().nullable(),
      request: z.string()
    }),
    execute: async (args, runtime) => {
      const intake = {
        action: "booking_request_captured",
        status: "captured",
        delivery: mockDeliveryChannels.schedulerIntake,
        intakeId: id("booking-intake", `${args.clientName ?? "client"}-${args.petName ?? "pet"}-${args.appointmentType ?? "appointment"}-${args.request}`),
        clientName: args.clientName ?? null,
        clientPhone: args.clientPhone ?? null,
        petName: args.petName ?? null,
        appointmentType: args.appointmentType ?? null,
        request: args.request,
        capturedAt: runtime.now.toISOString()
      };
      recordEvent(runtime, {
        eventType: "booking_request_captured",
        title: "Booking request captured",
        detail: args.request,
        metadata: intake
      });
      return { intake };
    }
  })
};
