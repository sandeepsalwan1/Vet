"use client";

import { CheckCircle2 } from "lucide-react";
import type { PublicAgentResponse } from "../lib/agentClient";

function titleize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function displayValue(value: unknown) {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : null;
}

function resultSummaryItems(result?: Record<string, unknown>) {
  if (!result) return [];
  const items: { label: string; value: string }[] = [];
  const add = (label: string, value: unknown) => {
    const text = displayValue(value);
    if (text) items.push({ label, value: text });
  };
  add("action", typeof result.action === "string" ? titleize(result.action) : null);
  add("confirmation", result.confirmationId);
  const appointment = recordValue(result.appointment);
  if (appointment) {
    const date = displayValue(appointment.appointmentDate);
    const time = displayValue(appointment.appointmentTime);
    const doctor = displayValue(appointment.doctor);
    const type = displayValue(appointment.appointmentType);
    add("appointment", [type, date, time, doctor ? `with ${doctor}` : ""].filter(Boolean).join(" "));
    add("status", appointment.status);
  }
  if (typeof result.waitEstimateMinutes === "number") add("wait", `${result.waitEstimateMinutes} min`);
  if (typeof result.ready === "boolean") add("pickup ready", result.ready);
  const statusUpdate = recordValue(result.statusUpdate);
  if (statusUpdate) add("portal update", statusUpdate.queued ? "queued" : statusUpdate.delivery);
  const outreach = recordValue(result.outreach);
  if (outreach) add("outreach", `${displayValue(outreach.status) ?? "queued"} via ${displayValue(outreach.channel) ?? "portal"}`);
  if (result.requiresApproval === true) add("checkpoint", "pending");
  if (typeof result.recordsSentAutomatically === "boolean") {
    add("records transfer", result.recordsSentAutomatically ? "queued" : "not queued");
  }
  return items.slice(0, 6);
}

export function PublicAgentResult({ response }: { response: PublicAgentResponse }) {
  const resultItems = resultSummaryItems(response.result);

  return (
    <div className="agentResult">
      <CheckCircle2 size={26} />
      <div>
        <h2>{response.intent || "Done"}</h2>
        <p>{response.message}</p>
        <dl>
          {resultItems.map((item) => (
            <div key={`${item.label}-${item.value}`}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
          <div>
            <dt>mode</dt>
            <dd>{response.mode || "mock"}</dd>
          </div>
          {response.task?.id ? (
            <div>
              <dt>task</dt>
              <dd>{response.task.id}</dd>
            </div>
          ) : null}
          {response.approval?.id ? (
            <div>
              <dt>approval</dt>
              <dd>{response.approval.id}</dd>
            </div>
          ) : null}
          {response.runId ? (
            <div>
              <dt>run</dt>
              <dd>{response.runId}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </div>
  );
}
