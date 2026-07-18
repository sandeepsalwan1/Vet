import { planClientJourneyMessage } from "@central-vet/db";
import type { ClientMessagePlan } from "@central-vet/notifications";

export async function persistClientJourneyPlans(args: {
  clinicId: string;
  clientId: string;
  petId: string;
  appointmentId?: string | null;
  eventId?: string | null;
  plans: ClientMessagePlan[];
}) {
  await Promise.all(args.plans.map((plan) => planClientJourneyMessage({
    clinicId: args.clinicId,
    clientId: args.clientId,
    petId: args.petId,
    appointmentId: args.appointmentId,
    eventId: args.eventId,
    ...plan
  })));
}
