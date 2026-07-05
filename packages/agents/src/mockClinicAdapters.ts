import type { MockAppointment } from "./contracts";
import type { AdapterContext, VetAgentAdapters } from "./adapters";
import { mockDeliveryChannels } from "./agentVocabulary";
import {
  clientFor,
  firstClient,
  firstPet,
  id,
  looseMatch,
  petFor
} from "./mockClinicLookup";

type RecordsTransferInput = Parameters<VetAgentAdapters["records"]["completeTransfer"]>[0];
type RecordsTransferResult = Awaited<ReturnType<VetAgentAdapters["records"]["completeTransfer"]>>;

function todayText(context: AdapterContext) {
  return context.now.toISOString().slice(0, 10);
}

function isTodayOrLiteralToday(date: string, context: AdapterContext) {
  return date === "today" || date === todayText(context);
}

function recordsTransfer(input: RecordsTransferInput, sentAt: string): RecordsTransferResult {
  const hasDestination = Boolean(input.destination?.trim());
  return {
    status: hasDestination ? "sent" : "blocked",
    delivery: mockDeliveryChannels.securePortal,
    clientName: input.clientName ?? null,
    petName: input.petName ?? null,
    destination: input.destination ?? null,
    confirmationId: id("records-transfer", `${input.clientName ?? "client"}-${input.petName ?? "pet"}-${input.destination ?? "destination"}`),
    sentAt: hasDestination ? sentAt : null
  };
}

export function createMockClinicAdapters(context: AdapterContext): VetAgentAdapters {
  const { data } = context;
  return {
    clients: {
      async findClients(input) {
        if (!input.clientName && !input.phone) return data.clients;
        const client = firstClient(data, input.clientName, input.phone);
        return client ? [client] : [];
      },
      async getClient(clientId) {
        return clientFor(data, clientId);
      }
    },
    pets: {
      async findPets(input) {
        return data.pets.filter((pet) =>
          pet.clientId === input.clientId && (!input.petName || looseMatch(pet.name, input.petName))
        );
      },
      async getPet(petId) {
        return petFor(data, petId);
      }
    },
    appointments: {
      async findAppointments(input) {
        return data.appointments.filter((appointment) => {
          if (input.clientId && appointment.clientId !== input.clientId) return false;
          if (input.petId && appointment.petId !== input.petId) return false;
          if (input.status && appointment.status !== input.status) return false;
          if (input.date && appointment.appointmentDate !== input.date && !(input.date === "today" && isTodayOrLiteralToday(appointment.appointmentDate, context))) return false;
          return true;
        });
      },
      async listSlots(input) {
        return data.slots.filter((slot) =>
          slot.available && (!input.appointmentType || looseMatch(slot.appointmentType, input.appointmentType))
        );
      },
      async bookAppointment(input) {
        const slot = data.slots.find((candidate) => candidate.id === input.slotId && candidate.available) ?? null;
        const client = clientFor(data, input.clientId);
        const pet = petFor(data, input.petId);
        if (!slot || !client || !pet) {
          return { booked: false, action: "booking_not_completed", appointment: null, slot, client, pet, task: null };
        }
        slot.available = false;
        const appointment: MockAppointment = {
          id: id("appointment", `${slot.id}-${pet.id}`),
          clientId: client.id,
          petId: pet.id,
          appointmentDate: slot.slotDate,
          appointmentTime: slot.slotTime,
          appointmentType: slot.appointmentType,
          doctor: slot.doctor,
          status: "scheduled",
          waitMinutes: 0,
          roomStatus: "waiting",
          notes: input.reason ?? "Booked by VetAgent."
        };
        data.appointments.push(appointment);
        return {
          booked: true,
          action: "appointment_booked",
          confirmationId: appointment.id,
          appointment,
          slot: { ...slot, available: false },
          client,
          pet,
          task: null
        };
      },
      async matchArrival(input) {
        const client = firstClient(data, input.clientName, input.clientPhone);
        const pet = client ? firstPet(data, client.id, input.petName) : null;
        const appointment = pet
          ? data.appointments.find((candidate) =>
              candidate.petId === pet.id &&
              candidate.clientId === pet.clientId &&
              isTodayOrLiteralToday(candidate.appointmentDate, context) &&
              (candidate.status === "scheduled" || candidate.status === "arrived")
            ) ?? null
          : null;
        return { client, pet, appointment };
      },
      async getWaitStatus(input) {
        const appointment = data.appointments.find((candidate) =>
          (input.appointmentId && candidate.id === input.appointmentId) ||
          (input.petId && candidate.petId === input.petId)
        ) ?? null;
        return appointment
          ? {
              appointmentId: appointment.id,
              waitMinutes: appointment.waitMinutes,
              queuePosition: appointment.waitMinutes > 0 ? 2 : 0,
              roomStatus: appointment.roomStatus
            }
          : null;
      }
    },
    pricing: {
      async listServices() {
        return data.services;
      },
      async listObservations(input) {
        return input?.source
          ? data.pricingObservations.filter((item) => item.source === input.source)
          : data.pricingObservations;
      },
      async replaceObservations(observations) {
        data.pricingObservations = observations;
        return data.pricingObservations;
      }
    },
    invoices: {
      async findInvoices(input) {
        return data.invoices.filter((invoice) =>
          (!input.clientId || invoice.clientId === input.clientId) &&
          (!input.petId || invoice.petId === input.petId)
        );
      },
      async getInvoiceContext(invoiceId) {
        const invoice = data.invoices.find((candidate) => candidate.id === invoiceId) ?? null;
        const client = invoice ? clientFor(data, invoice.clientId) : null;
        const pet = invoice ? petFor(data, invoice.petId) : null;
        return { invoice, client, pet };
      }
    },
    records: {
      async auditTransfer(input) {
        const missingDestination = !input.destination?.trim();
        return {
          status: missingDestination ? "blocked" : "passed",
          source: "local_records_policy",
          reason: missingDestination
            ? "Destination is missing; transfer is blocked until a destination is provided."
            : "Client identity and destination fields passed demo transfer policy.",
          checkedAt: context.now.toISOString(),
          requiresApproval: false,
          clientName: input.clientName ?? null,
          petName: input.petName ?? null,
          destination: input.destination ?? null
        };
      },
      async preparePacket(input) {
        return {
          clientName: input.clientName ?? null,
          petName: input.petName ?? null,
          destination: input.destination ?? null,
          requiresApproval: false,
          attachments: ["vaccine-summary.pdf", "visit-notes.pdf"]
        };
      },
      async completeTransfer(input) {
        return recordsTransfer(input, context.now.toISOString());
      }
    },
    labs: {
      async listCatalog(input) {
        return (data.labCatalog ?? []).filter((item) =>
          typeof input?.active === "boolean" ? item.active === input.active : true
        );
      },
      async findOrders(input) {
        return (data.labOrders ?? []).filter((order) => {
          if (input.clientId && order.clientId !== input.clientId) return false;
          if (input.petId && order.petId !== input.petId) return false;
          if (input.status && order.status !== input.status) return false;
          if (input.patientName && !looseMatch(order.patientName, input.patientName)) return false;
          return true;
        });
      },
      async getResult(input) {
        const result = (data.labResults ?? []).find((item) =>
          (input.labOrderId && item.labOrderId === input.labOrderId) ||
          (input.externalOrderId && item.externalOrderId === input.externalOrderId)
        ) ?? null;
        const order = result
          ? (data.labOrders ?? []).find((item) => item.id === result.labOrderId) ?? null
          : null;
        return { order, result };
      }
    },
    messaging: {
      async sendFollowupOutreach(candidateId) {
        const candidate = data.followups.find((item) => item.id === candidateId) ?? null;
        const client = candidate ? clientFor(data, candidate.clientId) : null;
        const pet = candidate ? petFor(data, candidate.petId) : null;
        if (!candidate || !client || !pet) return { candidate, task: null };
        candidate.status = "contacted";
        return {
          candidate,
          client,
          pet,
          outreach: {
            status: "sent",
            channel: mockDeliveryChannels.clientPortal,
            sentAt: context.now.toISOString(),
            message: `${pet.name} is due for ${candidate.followupType}. ${candidate.recommendedAction}`
          },
          task: null
        };
      }
    }
  };
}
