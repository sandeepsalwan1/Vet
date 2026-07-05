import { z } from "zod";
import { mockDeliveryChannels, mockLabDataSource, mockLabVendor } from "../agentVocabulary";
import type { MockLabOrder } from "../contracts";
import {
  clientFor,
  defineTool,
  petFor,
  recordEvent,
  type ToolRuntime
} from "../toolCore";

async function firstLabOrder(runtime: ToolRuntime, args: { clientId?: string; petId?: string; status?: string; patientName?: string }) {
  const orders = await runtime.adapters.labs.findOrders(args);
  return orders[0] ?? null;
}

async function labOrderById(runtime: ToolRuntime, labOrderId: string) {
  return (await runtime.adapters.labs.findOrders({})).find((item) => item.id === labOrderId) ?? null;
}

function prepareLabClientUpdate(order: MockLabOrder | null, runtime: ToolRuntime) {
  const result = order ? (runtime.data.labResults ?? []).find((item) => item.labOrderId === order.id) ?? null : null;
  const client = order ? clientFor(runtime.data, order.clientId) : null;
  const pet = order ? petFor(runtime.data, order.petId) : null;
  const abnormal = Boolean(result?.abnormalFlags?.length);
  const update = {
    action: abnormal ? "lab_client_update_held" : "lab_client_update_prepared",
    status: abnormal ? "held_for_doctor" : "prepared",
    delivery: mockDeliveryChannels.clientPortal,
    clientName: client?.fullName ?? null,
    clientPhone: client?.phone ?? null,
    petName: pet?.name ?? order?.patientName ?? null,
    labVendor: order?.labVendor ?? mockLabVendor,
    externalOrderId: order?.externalOrderId ?? null,
    abnormalFlags: result?.abnormalFlags ?? [],
    message: abnormal
      ? "Lab result summary prepared; abnormal flags are held from client delivery until doctor release."
      : "Lab result summary prepared for client portal delivery.",
    medicalAdviceGiven: false,
    preparedAt: runtime.now.toISOString()
  };
  recordEvent(runtime, {
    eventType: update.action,
    title: abnormal ? "Lab client update held" : "Lab client update prepared",
    detail: "No diagnosis or treatment recommendation was provided.",
    metadata: update
  });
  return { update, order, result, client, pet };
}

export const labTools = {
  list_lab_catalog: defineTool({
    description: "List mock lab catalog entries shaped like a future lab adapter.",
    parameters: z.object({
      active: z.boolean().optional()
    }),
    execute: async (args, runtime) => {
      const catalog = await runtime.adapters.labs.listCatalog(args);
      return { labVendor: mockLabVendor, catalog };
    }
  }),
  lookup_lab_orders: defineTool({
    description: "Look up mock lab orders by patient, client, pet, or status.",
    parameters: z.object({
      clientId: z.string().optional(),
      petId: z.string().optional(),
      patientName: z.string().optional(),
      status: z.enum(["ordered", "in_progress", "partial", "final", "cancelled"]).optional()
    }),
    execute: async (args, runtime) => {
      const orders = await runtime.adapters.labs.findOrders(args);
      return { labVendor: mockLabVendor, orders };
    }
  }),
  get_lab_result: defineTool({
    description: "Fetch mock lab result metadata for an order/accession.",
    parameters: z.object({
      labOrderId: z.string().optional(),
      externalOrderId: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const { order, result } = await runtime.adapters.labs.getResult(args);
      return { labVendor: mockLabVendor, order, result };
    }
  }),
  summarize_lab_result: defineTool({
    description: "Summarize mock lab result without giving diagnosis or treatment advice.",
    parameters: z.object({
      labOrderId: z.string().optional(),
      externalOrderId: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const match = await runtime.adapters.labs.getResult(args);
      const result = match.result;
      const order = match.order ?? await firstLabOrder(runtime, { status: "final" });
      const summary = result
        ? {
            labVendor: result.labVendor,
            source: mockLabDataSource,
            externalOrderId: result.externalOrderId,
            status: result.status,
            resultSummary: result.resultSummary,
            abnormalFlags: result.abnormalFlags,
            reportUrl: result.reportUrl,
            medicalAdviceGiven: false
          }
        : {
            labVendor: mockLabVendor,
            source: mockLabDataSource,
            status: order?.status ?? "not_found",
            resultSummary: "No finalized mock lab result matched.",
            abnormalFlags: [],
            reportUrl: null,
            medicalAdviceGiven: false
          };
      return { order, result, summary };
    }
  }),
  prepare_lab_client_update: defineTool({
    description: "Prepare a mock lab-result client update without giving medical advice or creating a task.",
    parameters: z.object({
      labOrderId: z.string(),
      reason: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const order = await labOrderById(runtime, args.labOrderId);
      return { ...prepareLabClientUpdate(order, runtime), medicalAdviceGiven: false };
    }
  })
};
