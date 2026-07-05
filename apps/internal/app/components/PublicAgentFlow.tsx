"use client";

import { Bot, Loader2, Send } from "lucide-react";
import { FormEvent, useState } from "react";
import {
  runPublicAgentFlow,
  type PublicAgentResponse,
  type PublicAgentWorkflow
} from "../lib/agentClient";
import { formatPhoneInput } from "../lib/phoneText";
import { useClinicBrand } from "./ClinicContext";
import { PublicAgentResult } from "./PublicAgentResult";
import { publicAgentFlowConfigs } from "./publicAgentFlowConfig";

type PublicAgentFlowProps = {
  workflow: PublicAgentWorkflow;
};

const blanks = {
  clientName: "",
  clientPhone: "",
  petName: "",
  destination: "",
  message: ""
};

export function PublicAgentFlow({
  workflow
}: PublicAgentFlowProps) {
  const config = publicAgentFlowConfigs[workflow];
  const clinic = useClinicBrand();
  const [form, setForm] = useState(blanks);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [response, setResponse] = useState<PublicAgentResponse | null>(null);

  const update = (key: keyof typeof blanks, value: string) => {
    setForm({ ...form, [key]: value });
    setError("");
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setResponse(null);
    try {
      setResponse(await runPublicAgentFlow({
        workflow,
        clientName: form.clientName,
        clientPhone: form.clientPhone,
        petName: form.petName,
        destination: form.destination,
        message: form.message,
        transcript: config.transcript
      }));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Request failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="publicShell">
      <section className="publicPanel">
        <div className="publicHeader">
          <Bot size={28} />
          <div>
            <p>{clinic.name}</p>
            <h1>{config.title}</h1>
          </div>
        </div>
        <form className="publicForm" onSubmit={submit}>
          <div className="publicGrid">
            <label>
              Your name
              <input
                value={form.clientName}
                onChange={(event) => update("clientName", event.target.value)}
                autoFocus
              />
            </label>
            <label>
              Phone
              <input
                value={form.clientPhone}
                onChange={(event) => update("clientPhone", formatPhoneInput(event.target.value))}
                inputMode="tel"
              />
            </label>
            <label>
              Pet name
              <input value={form.petName} onChange={(event) => update("petName", event.target.value)} />
            </label>
            {config.destination ? (
              <label>
                Destination hospital
                <input value={form.destination} onChange={(event) => update("destination", event.target.value)} />
              </label>
            ) : null}
          </div>
          <label>
            {config.prompt}
            <textarea
              rows={6}
              value={form.message}
              placeholder={config.placeholder}
              onChange={(event) => update("message", event.target.value)}
            />
          </label>
          {error ? <div className="errorBox">{error}</div> : null}
          <button className="sendButton" type="submit" disabled={submitting}>
            {submitting ? <Loader2 className="spinIcon" size={18} /> : <Send size={18} />}
            {submitting ? "Sending" : config.buttonLabel}
          </button>
        </form>
        {response ? <PublicAgentResult response={response} /> : null}
      </section>
      <nav className="publicNav" aria-label="Client flows">
        <a href="/arrival">Arrival</a>
        <a href="/booking">Booking</a>
        <a href="/pickup">Pickup</a>
        <a href="/records">Records</a>
        <a href="/followup">Follow-up</a>
        <a href="/request">Request</a>
      </nav>
    </main>
  );
}
