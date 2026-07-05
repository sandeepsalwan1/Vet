import type { AgentIntent, MockClinicData } from "@central-vet/agents";
import {
  listAgentReports,
  listApprovals,
  listMockClinic,
  listTasks
} from "@central-vet/db";

export async function loadAgentClinicData(clinicId: string): Promise<MockClinicData> {
  const [clinic, tasks, approvals, reports] = await Promise.all([
    listMockClinic({ clinicId }),
    listTasks({ clinicId, role: "admin", includeArchived: false }),
    listApprovals({ clinicId, status: "pending", limit: 50 }),
    listAgentReports({ clinicId, limit: 50 })
  ]);
  return {
    clients: clinic.clients.map((client) => ({
      id: client.id,
      fullName: client.fullName,
      phone: client.phone,
      email: client.email ?? undefined,
      notes: client.notes ?? undefined
    })),
    pets: clinic.pets.map((pet) => ({
      id: pet.id,
      clientId: pet.clientId,
      name: pet.name,
      species: pet.species,
      breed: pet.breed ?? undefined,
      alerts: pet.alerts ?? undefined
    })),
    appointments: clinic.appointments.map((appointment) => ({
      ...appointment,
      status: appointment.status as MockClinicData["appointments"][number]["status"],
      roomStatus: appointment.roomStatus as MockClinicData["appointments"][number]["roomStatus"],
      notes: appointment.notes ?? undefined
    })),
    slots: clinic.slots,
    followups: clinic.followups.map((followup) => ({
      ...followup,
      status: followup.status as MockClinicData["followups"][number]["status"]
    })),
    invoices: clinic.invoices.map((invoice) => ({
      id: invoice.id,
      clientId: invoice.clientId,
      petId: invoice.petId,
      invoiceNumber: invoice.invoiceNumber,
      status: invoice.status as MockClinicData["invoices"][number]["status"],
      totalCents: invoice.totalCents,
      flags: invoice.flags.map((flag) => ({
        reason: typeof flag.reason === "string"
          ? flag.reason
          : typeof flag.message === "string"
            ? flag.message
            : "Invoice flag needs review.",
        severity: flag.severity === "low" || flag.severity === "high" ? flag.severity : "medium"
      }))
    })),
    services: clinic.services,
    pricingObservations: clinic.pricingObservations.map((observation) => ({
      id: observation.id,
      source: observation.source === "apify" ? "apify" : "sample",
      competitorName: observation.competitorName,
      serviceName: observation.serviceName,
      observedPriceCents: observation.observedPriceCents,
      observedText: observation.observedText ?? undefined,
      url: observation.url ?? undefined
    })),
    messages: clinic.messages.map((message) => ({
      id: message.id,
      clientId: message.clientId,
      body: message.body,
      intentHint: message.intentHint as AgentIntent | undefined,
      urgency: message.urgency === "urgent" ? "high" : message.urgency === "high" ? "high" : "normal"
    })),
    calls: clinic.callTranscripts.map((call) => ({
      id: call.id,
      callerName: call.callerName,
      callerPhone: call.callerPhone,
      transcript: call.transcript,
      intentHint: call.intentHint as AgentIntent | undefined
    })),
    tasks: tasks.map((task) => ({
      id: task.id,
      status: task.status,
      priority: task.priority,
      requestType: task.requestType,
      clientName: task.clientName,
      petName: task.petName,
      request: task.request,
      notes: task.notes,
      dueDate: task.dueDate,
      dueTime: task.dueTime
    })),
    approvals: approvals.map((approval) => ({
      id: approval.id,
      status: approval.status,
      approvalType: approval.approvalType,
      title: approval.title,
      summary: approval.summary,
      taskId: approval.taskId
    })),
    reports: reports.map((report) => ({
      id: report.id,
      reportType: report.reportType,
      title: report.title,
      summary: report.summary,
      taskId: report.taskId
    })),
    labCatalog: clinic.labCatalog,
    labOrders: clinic.labOrders.map((order) => ({
      ...order,
      status: order.status as NonNullable<MockClinicData["labOrders"]>[number]["status"]
    })),
    labResults: clinic.labResults.map((result) => ({
      ...result,
      status: result.status as NonNullable<MockClinicData["labResults"]>[number]["status"]
    }))
  };
}
