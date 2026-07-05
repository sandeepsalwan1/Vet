import { z } from "zod";
import { defineTool, recordEvent } from "../toolCore";

export const recordsTools = {
  audit_records_transfer: defineTool({
    description: "Run local records-transfer policy audit before automated secure transfer.",
    parameters: z.object({
      clientName: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      destination: z.string().optional().nullable()
    }),
    execute: async (args, runtime) => {
      const audit = await runtime.adapters.records.auditTransfer(args);
      recordEvent(runtime, {
        eventType: "records_audit_passed",
        title: "Records transfer audited locally",
        detail: audit.reason,
        metadata: audit
      });
      return { audit };
    }
  }),
  prepare_records_packet: defineTool({
    description: "Prepare records metadata for automated secure transfer.",
    parameters: z.object({
      clientName: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      destination: z.string().optional().nullable()
    }),
    execute: async (args, runtime) => ({ packet: await runtime.adapters.records.preparePacket(args) })
  }),
  complete_records_transfer: defineTool({
    description: "Submit a secure mock records transfer after the local audit passes.",
    parameters: z.object({
      clientName: z.string().optional().nullable(),
      petName: z.string().optional().nullable(),
      destination: z.string().optional().nullable(),
      request: z.string().optional().nullable()
    }),
    execute: async (args, runtime) => {
      const transfer = await runtime.adapters.records.completeTransfer(args);
      recordEvent(runtime, {
        eventType: "records_transfer_sent",
        title: "Records transfer sent",
        detail: transfer.status === "sent"
          ? `Secure transfer submitted for ${args.destination}.`
          : "Records transfer blocked because destination is missing.",
        metadata: { ...transfer, action: "records_transfer_sent" }
      });
      return { transfer, sent: transfer.status === "sent", recordsSentAutomatically: transfer.status === "sent" };
    }
  })
};
