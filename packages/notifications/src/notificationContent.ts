import type { Task } from "@central-vet/db";

const defaultClinicName = "Central Veterinary Hospital";

function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sourceLabel(source: Task["source"]) {
  return source
    .replace("_form", " form")
    .replace("_request", " request")
    .replace("_", " ");
}

function formatPhone(value: string | null) {
  const clean = value?.trim();
  if (!clean) return "Not listed";
  if (clean.includes("@")) return clean;
  const digits = clean.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length === 10) {
    const formatted = `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
    return digits.length === 11 ? `+1 ${formatted}` : formatted;
  }
  if (local.length === 7) return `${local.slice(0, 3)}-${local.slice(3)}`;
  return clean;
}

export function dailyPrioritySummaryHtml(tasks: Task[], localDate: string, clinicName = defaultClinicName) {
  const rows = tasks
    .map(
      (task) => `
        <li style="margin:0 0 12px 0;">
          <strong>${escapeHtml(task.petName || task.clientName || "Task")}</strong>
          <span style="color:#64748b;">(${escapeHtml(task.status)} · ${escapeHtml(sourceLabel(task.source))})</span><br />
          <span>${escapeHtml(task.request)}</span><br />
          <span style="color:#64748b;">Client: ${escapeHtml(task.clientName || "Not listed")} · Phone: ${escapeHtml(formatPhone(task.clientPhone))} · Due: ${escapeHtml(task.dueDate)}</span>
        </li>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.45;">
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(clinicName)} daily priority summary</h1>
      <p style="margin:0 0 16px;">${tasks.length} medium/high priority task${tasks.length === 1 ? "" : "s"} are still open at end of day ${escapeHtml(localDate)}.</p>
      <ul style="padding-left:20px;margin:0;">${rows}</ul>
    </div>
  `;
}

export function agentExampleHtml(
  message: string,
  sentBy: string | undefined,
  localDate: string,
  clinicName = defaultClinicName
) {
  const byline = sentBy ? `<p style="margin:0 0 12px;color:#64748b;">Sent by ${escapeHtml(sentBy)} via VetAgent.</p>` : "";
  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.45;">
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(clinicName)} agent email</h1>
      ${byline}
      <p style="margin:0 0 12px;">${escapeHtml(message)}</p>
      <p style="margin:0;color:#64748b;">Example send verified for ${escapeHtml(localDate)}.</p>
    </div>
  `;
}

function truncateText(value: string, maxLength = 480) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}

export function agentExampleText(
  message: string,
  sentBy: string | undefined,
  localDate: string,
  clinicName = defaultClinicName
) {
  const byline = sentBy ? ` Sent by ${sentBy} via VetAgent.` : "";
  return truncateText(`${clinicName} agent email.${byline} ${message} Example send verified for ${localDate}.`);
}

export function dailyPrioritySummaryText(tasks: Task[], localDate: string, clinicName = defaultClinicName) {
  const firstTasks = tasks
    .slice(0, 3)
    .map((task) => {
      const name = task.petName || task.clientName || "Task";
      const phone = task.clientPhone ? ` ${formatPhone(task.clientPhone)}` : "";
      return `${name}: ${task.request}${phone}`;
    })
    .join(" | ");
  const more = tasks.length > 3 ? ` +${tasks.length - 3} more.` : "";
  return truncateText(`${clinicName} end-of-day medium/high ${localDate}: ${tasks.length} open task${tasks.length === 1 ? "" : "s"}. ${firstTasks}${more}`);
}

export function escalationHtml(task: Task, clinicName = defaultClinicName) {
  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.45;">
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(clinicName)} escalated task</h1>
      <p style="margin:0 0 8px;"><strong>${escapeHtml(task.petName || task.clientName || "Task")}</strong></p>
      <p style="margin:0 0 8px;">${escapeHtml(task.request)}</p>
      <p style="margin:0;color:#64748b;">Client: ${escapeHtml(task.clientName || "Not listed")} · Phone: ${escapeHtml(formatPhone(task.clientPhone))} · Due: ${escapeHtml(task.dueDate)}</p>
    </div>
  `;
}

export function escalationText(task: Task, clinicName = defaultClinicName) {
  const name = task.petName || task.clientName || "Task";
  const phone = task.clientPhone ? ` Phone: ${formatPhone(task.clientPhone)}.` : "";
  return truncateText(`${clinicName} escalated: ${name}. ${task.request}.${phone}`);
}

export function smokeTestHtml(localDate: string, clinicName = defaultClinicName) {
  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.45;">
      <h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(clinicName)} notification smoke test</h1>
      <p style="margin:0;">Email path is working for ${escapeHtml(localDate)}.</p>
    </div>
  `;
}
