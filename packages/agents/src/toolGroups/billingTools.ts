import { z } from "zod";
import {
  addEffect,
  defineTool,
  firstClient,
  firstPet,
  makeReport,
  recordEvent
} from "../toolCore";

async function createInvoiceReview(invoiceId: string, issueDetails: string, runtime: Parameters<typeof recordEvent>[0]) {
  const { invoice, client, pet } = await runtime.adapters.invoices.getInvoiceContext(invoiceId);
  const report = addEffect(runtime, makeReport({
    reportType: "invoice",
    title: "Invoice review",
    summary: issueDetails,
    taskId: null,
    data: { invoice, client, pet, changedInvoices: false }
  }));
  recordEvent(runtime, {
    eventType: "invoice_review_report_created",
    title: "Invoice review report created",
    detail: issueDetails,
    metadata: { invoiceId, reportId: report.id, changedInvoices: false }
  });
  return { invoice, client, pet, report, changedInvoices: false };
}

export const billingTools = {
  get_invoice_summary: defineTool({
    description: "Return invoice data for review.",
    parameters: z.object({
      clientName: z.string().optional(),
      petName: z.string().optional()
    }),
    execute: async (args, runtime) => {
      const client = firstClient(runtime.data, args.clientName);
      const pet = client ? firstPet(runtime.data, client.id, args.petName) : null;
      const invoices = await runtime.adapters.invoices.findInvoices({
        clientId: client?.id ?? null,
        petId: pet?.id ?? null
      });
      return { client, pet, invoices };
    }
  }),
  review_invoice_flags: defineTool({
    description: "Create a mock invoice audit report without mutating billing or creating a review task.",
    parameters: z.object({
      invoiceId: z.string(),
      issueDetails: z.string()
    }),
    execute: async (args, runtime) => createInvoiceReview(args.invoiceId, args.issueDetails, runtime)
  })
};
