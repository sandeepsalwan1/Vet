"use client";

import { Bot, ClipboardList, FileCheck2, Loader2, Mail, ReceiptText, Search, Stethoscope } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  runAgentConsoleAction,
  type AgentConsoleResult
} from "../lib/agentClient";
import { canManage } from "../lib/taskWorkflow";
import { useClinicBrand } from "./ClinicContext";
import { StaffAgentAuditPanel } from "./StaffAgentAuditPanel";
import { StaffAgentEmailControls, useStaffAgentEmailOptions } from "./StaffAgentEmailControls";
import { StaffAgentResultPanel } from "./StaffAgentResultPanel";
import { readStoredTaskBoardSession } from "./taskBoardBrowserState";
import type { TaskBoardSession as Session } from "./taskBoardTypes";
import { useStaffAgentAudit } from "./useStaffAgentAudit";

const quickActions = [
  { intent: "daily_ops", label: "Daily ops", icon: ClipboardList, endpoint: "/api/agent/daily-ops" },
  { intent: "pricing", label: "Pricing", icon: Search, endpoint: "/api/agent/pricing" },
  { intent: "invoice", label: "Invoices", icon: ReceiptText, endpoint: "/api/agent/invoice" },
  {
    intent: "email",
    label: "Email",
    icon: Mail,
    endpoint: "/api/agent/email",
    prompt: "Send the monthly example email from VetAgent."
  },
  { intent: "records", label: "Records", icon: FileCheck2, endpoint: "/api/agent/internal" },
  { intent: "sick_pet", label: "Sick pet", icon: Stethoscope, endpoint: "/api/agent/internal" }
] as const;

export function StaffAgentConsole() {
  const clinic = useClinicBrand();
  const [session, setSession] = useState<Session | null>(null);
  const [message, setMessage] = useState("Summarize what front desk should do next.");
  const [loading, setLoading] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<AgentConsoleResult | null>(null);
  const emailOptions = useStaffAgentEmailOptions();

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSession(readStoredTaskBoardSession());
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const actor = useMemo(() => {
    if (!session) return null;
    return {
      name: session.name,
      role: session.role,
      passcode: session.passcode,
      profileId: session.profileId
    };
  }, [session]);

  const audit = useStaffAgentAudit(actor);

  async function run(endpoint: string, intent?: string, promptOverride?: string) {
    if (!actor) return;
    const requestMessage = promptOverride ?? message;
    const emailPayload = intent === "email" ? emailOptions.payload : {};
    setLoading(intent || "freeform");
    setError("");
    setResult(null);
    try {
      const nextResult = await runAgentConsoleAction({
        endpoint,
        session: actor,
        message: requestMessage,
        intent,
        payload: emailPayload
      });
      setResult(nextResult);
      void audit.loadAudit();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Agent failed.");
    } finally {
      setLoading("");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    await run("/api/agent/internal");
  }

  if (!session) {
    return (
      <main className="staffToolShell">
        <section className="staffToolPanel">
          <h1>Internal Agent</h1>
          <p>Open the staff task board and sign in first.</p>
          <a className="primaryButton" href="/staff">Staff task board</a>
        </section>
      </main>
    );
  }

  if (!canManage(session.role)) {
    return (
      <main className="staffToolShell">
        <section className="staffToolPanel">
          <h1>Internal Agent</h1>
          <p>VA, Admin, or Veterinarian access is required.</p>
          <a className="primaryButton" href="/staff">Staff task board</a>
        </section>
      </main>
    );
  }

  return (
    <main className="staffToolShell">
      <section className="staffToolPanel">
        <div className="staffToolHeader">
          <Bot size={28} />
          <div>
            <p>{clinic.name}</p>
            <h1>Internal Agent</h1>
          </div>
        </div>
        <div className="staffQuickActions">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <button
                key={action.intent}
                type="button"
                className="plainButton"
                disabled={Boolean(loading)}
                onClick={() => void run(action.endpoint, action.intent, "prompt" in action ? action.prompt : undefined)}
              >
                {loading === action.intent ? <Loader2 className="spinIcon" size={17} /> : <Icon size={17} />}
                {action.label}
              </button>
            );
          })}
        </div>
        <StaffAgentEmailControls options={emailOptions} />
        <form className="staffAgentPrompt" onSubmit={submit}>
          <label>
            Agent request
            <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={5} />
          </label>
          <button className="primaryButton" type="submit" disabled={Boolean(loading)}>
            {loading ? <Loader2 className="spinIcon" size={17} /> : <Bot size={17} />}
            Run Agent
          </button>
        </form>
        {error ? <div className="errorBox">{error}</div> : null}
        {result ? <StaffAgentResultPanel result={result} /> : null}
        <StaffAgentAuditPanel audit={audit} />
      </section>
    </main>
  );
}
