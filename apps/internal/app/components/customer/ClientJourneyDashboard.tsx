"use client";

import type { ClientJourneyMessage, ClientJourneySnapshot } from "@central-vet/db";
import {
  CalendarCheck,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileUp,
  MessageSquareText,
  ThumbsDown,
  ThumbsUp
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountSession } from "../../lib/accountStore";
import { readClientJourney, updateClientJourney } from "./clientJourneyClient";

type Props = { session: AccountSession };

function appointmentLabel(snapshot: ClientJourneySnapshot) {
  const appointment = snapshot.appointment;
  if (!appointment) return "";
  const date = new Date(`${appointment.appointmentDate}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
  return `${date} at ${appointment.appointmentTime.slice(0, 5)}`;
}

function dueMessage(snapshot: ClientJourneySnapshot, type: string) {
  const now = Date.now();
  return snapshot.messages.find((message) =>
    message.messageType === type &&
    (message.status === "planned" || message.status === "sent") &&
    new Date(message.scheduledFor).getTime() <= now
  );
}

function feedbackAnswered(snapshot: ClientJourneySnapshot, message: ClientJourneyMessage, responseType: "visit_experience" | "pet_health") {
  const scheduledAt = new Date(message.scheduledFor).getTime();
  return snapshot.events.some((event) =>
    (event.eventType === `${responseType}_up` || event.eventType === `${responseType}_down`) &&
    new Date(event.occurredAt).getTime() >= scheduledAt
  );
}

function currentVisitStage(snapshot: ClientJourneySnapshot) {
  const appointment = snapshot.appointment;
  if (!appointment) return null;
  const startsAt = new Date(`${appointment.appointmentDate}T${appointment.appointmentTime}`).getTime();
  return snapshot.events.find((event) =>
    ["ready_for_pickup", "checkout", "discharge"].includes(event.eventType) &&
    new Date(event.occurredAt).getTime() >= startsAt
  )?.eventType ?? null;
}

export function ClientJourneyDashboard({ session }: Props) {
  const [snapshot, setSnapshot] = useState<ClientJourneySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!session.accessToken) return;
    setLoading(true);
    try {
      setSnapshot(await readClientJourney(session.accessToken));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Your care information could not load.");
    } finally {
      setLoading(false);
    }
  }, [session.accessToken]);

  useEffect(() => {
    const id = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function act(body: Record<string, unknown>) {
    if (!session.accessToken || saving) return;
    setSaving(true);
    setNotice("");
    setError("");
    try {
      const result = await updateClientJourney(session.accessToken, body);
      setNotice(result.message);
      await load();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "That request could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const state = useMemo(() => {
    if (!snapshot) return null;
    const stage = currentVisitStage(snapshot);
    const appointment = snapshot.appointment && !stage && !["cancelled", "canceled", "completed", "checked_out"].includes(snapshot.appointment.status.toLowerCase())
      ? snapshot.appointment
      : null;
    const discharge = stage === "checkout" || stage === "discharge" ? dueMessage(snapshot, "discharge") : null;
    const pickup = stage === "ready_for_pickup" ? dueMessage(snapshot, "ready_for_pickup") : null;
    const feedbackMessage = dueMessage(snapshot, "visit_experience");
    const feedback = feedbackMessage && !feedbackAnswered(snapshot, feedbackMessage, "visit_experience") ? feedbackMessage : null;
    const petHealthMessage = dueMessage(snapshot, "pet_health_check");
    const petHealth = petHealthMessage && !feedbackAnswered(snapshot, petHealthMessage, "pet_health") ? petHealthMessage : null;
    return { appointment, discharge, pickup, feedback, petHealth };
  }, [snapshot]);

  if (!session.accessToken) return null;

  return (
    <section className="journeyWorkspace" aria-label="Current care status">
      {loading ? <p className="journeyLoading">Loading care status…</p> : null}
      {error ? <div className="alertLine">{error}</div> : null}
      {notice ? <div className="journeyNotice"><Check size={15} /> {notice}</div> : null}

      {snapshot && state?.appointment ? (
        <section className="journeyCurrentState">
          <div className="journeyStateHeading">
            <CalendarCheck size={18} />
            <div><span>Upcoming appointment</span><strong>{appointmentLabel(snapshot)}</strong></div>
            <small>{state.appointment.appointmentType} · {state.appointment.doctor}</small>
          </div>
          <details>
            <summary>Prepare for the visit</summary>
            <ul>
              <li>Complete pre-check-in</li>
              <li>Bring medication names and questions</li>
              <li>Send prior records if transferring care</li>
            </ul>
            <a href="/records"><FileUp size={15} /> Upload records <ChevronRight size={14} /></a>
          </details>
        </section>
      ) : null}

      {state?.discharge || state?.pickup ? (
        <section className="journeySignal">
          <CircleDollarSign size={18} />
          <div>
            <span>{state.discharge ? "Discharge" : "Pickup"}</span>
            <strong>{state.discharge ? "Discharge instructions are ready" : `${snapshot?.profile.petName ?? "Your pet"} is ready for pickup`}</strong>
          </div>
        </section>
      ) : null}

      {state?.feedback ? (
        <section className="journeyFeedbackPrompt">
          <div><MessageSquareText size={18} /><strong>How was your visit?</strong></div>
          <div>
            <button type="button" disabled={saving} onClick={() => void act({ action: "feedback", responseType: "visit_experience", sentiment: "up" })}><ThumbsUp size={16} /> Good</button>
            <button type="button" disabled={saving} onClick={() => void act({ action: "feedback", responseType: "visit_experience", sentiment: "down" })}><ThumbsDown size={16} /> Follow up</button>
          </div>
        </section>
      ) : null}

      {state?.petHealth ? (
        <section className="journeyFeedbackPrompt">
          <div><MessageSquareText size={18} /><strong>How is {snapshot?.profile.petName ?? "your pet"} doing?</strong></div>
          <div>
            <button type="button" disabled={saving} onClick={() => void act({ action: "feedback", responseType: "pet_health", sentiment: "up" })}><ThumbsUp size={16} /> Doing well</button>
            <button type="button" disabled={saving} onClick={() => void act({ action: "feedback", responseType: "pet_health", sentiment: "down" })}><ThumbsDown size={16} /> Call me</button>
          </div>
        </section>
      ) : null}

      {!loading && snapshot ? (
        <button className="journeyRecordsButton" type="button" disabled={saving} onClick={() => void act({ action: "records_request" })}>
          <ClipboardCheck size={16} /> Request records
        </button>
      ) : null}
    </section>
  );
}
