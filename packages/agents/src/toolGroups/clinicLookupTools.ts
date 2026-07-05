import { z } from "zod";
import { defineTool } from "../toolCore";

export const clinicLookupTools = {
  lookup_client: defineTool({
    description: "Look up a client by name or phone number.",
    parameters: z.object({
      clientName: z.string().optional(),
      phone: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const clients = await runtime.adapters.clients.findClients(args);
      return { clients };
    }
  }),
  lookup_pet: defineTool({
    description: "Look up pets registered to a client.",
    parameters: z.object({
      clientId: z.string(),
      petName: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const pets = await runtime.adapters.pets.findPets(args);
      return { pets };
    }
  }),
  lookup_appointment: defineTool({
    description: "Look up appointments by client, pet, status, or date.",
    parameters: z.object({
      clientId: z.string().optional(),
      petId: z.string().optional(),
      status: z.enum(["scheduled", "arrived", "ready", "completed"]).optional(),
      date: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const appointments = await runtime.adapters.appointments.findAppointments(args);
      return { appointments };
    }
  }),
  list_slots: defineTool({
    description: "List available appointment slots.",
    parameters: z.object({
      appointmentType: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const slots = await runtime.adapters.appointments.listSlots(args);
      return { slots };
    }
  }),
  start_arrival: defineTool({
    description: "Match an arriving client and pet to today's appointment.",
    parameters: z.object({
      clientName: z.string().optional(),
      clientPhone: z.string().optional(),
      petName: z.string().optional()
    }),
    execute: async (args, runtime) => {
      return runtime.adapters.appointments.matchArrival(args);
    }
  }),
  get_wait_status: defineTool({
    description: "Return wait estimate for an appointment.",
    parameters: z.object({
      appointmentId: z.string().optional(),
      petId: z.string().optional()
    }),
    execute: async (args, runtime) => {
      return {
        waitStatus: await runtime.adapters.appointments.getWaitStatus(args)
      };
    }
  })
};
