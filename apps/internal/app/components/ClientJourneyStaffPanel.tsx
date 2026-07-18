"use client";

import type { StaffClientJourneySnapshot } from "@central-vet/db";
import { BellRing, BedDouble, CalendarX2, CheckCircle2, CircleDollarSign, MessageSquareText, Send } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readStaffClientJourney, sendStaffClientUpdate } from "./staffJourneyClient";
import type { TaskBoardSession } from "./taskBoardTypes";

type Props = {
  session: TaskBoardSession;
  actorQuery: string;
  onError(message: string): void;
};

function messageLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function ClientJourneyStaffPanel({ session, actorQuery, onError }: Props) {
  const [snapshot, setSnapshot] = useState<StaffClientJourneySnapshot | null>(null);
  const [clientKey, setClientKey] = useState("");
  const [detail, setDetail] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!actorQuery) return;
    try {
      const next = await readStaffClientJourney(session, actorQuery);
      setSnapshot(next);
      setClientKey((current) => current || (next.clients[0] ? `${next.clients[0].clientId}:${next.clients[0].petId}` : ""));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Client journeys failed.");
    }
  }, [actorQuery, onError, session]);

  useEffect(() => {
    const first = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(), 30000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, [load]);

  const selected = useMemo(() => snapshot?.clients.find((client) => `${client.clientId}:${client.petId}` === clientKey) ?? null, [clientKey, snapshot]);

  async function send(updateType: "hospitalized_update" | "ready_for_pickup" | "checkout" | "appointment_changed") {
    if (!selected || saving) return;
    setSaving(true);
    setNotice("");
    try {
      const result = await sendStaffClientUpdate(session, {
        clientId: selected.clientId,
        petId: selected.petId,
        appointmentId: selected.appointmentId,
        updateType,
        detail: detail.trim() || undefined,
        balanceCents: selected.invoiceBalanceCents
      });
      setNotice(`${result.planned} customer message${result.planned === 1 ? "" : "s"} queued.`);
      setDetail("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Client update failed.");
    } finally {
      setSaving(false);
    }
  }

  if (!snapshot) return null;
  const pressure = snapshot.roomPressure;

  return (
    <section className="staffJourneyPanel">
      <div className="staffJourneyHeader">
        <div><p className="eyebrow">Client journey</p><h2>Visit updates and follow-up</h2></div>
        <div className={`roomPressure ${pressure.pressured ? "roomPressure--high" : ""}`}>
          <BedDouble size={17} />
          <span><strong>{pressure.occupied}/{pressure.total} rooms occupied</strong><small>{pressure.pressured ? `At ${pressure.thresholdLabel} pressure threshold` : "Normal room load"}</small></span>
        </div>
      </div>

      <div className="staffJourneyComposer">
        <label>Client and pet<select value={clientKey} onChange={(event) => setClientKey(event.target.value)}>{snapshot.clients.map((client) => <option key={`${client.clientId}:${client.petId}`} value={`${client.clientId}:${client.petId}`}>{client.petName} · {client.clientName}</option>)}</select></label>
        <label>Visit-safe update<textarea value={detail} onChange={(event) => setDetail(event.target.value)} placeholder="Add a concise update. Keep clinical detail in approved discharge documents." /></label>
        <div className="staffJourneyActions">
          <button type="button" disabled={!selected || saving} onClick={() => void send("hospitalized_update")}><MessageSquareText size={16} /> Care update</button>
          <button type="button" disabled={!selected || saving} onClick={() => void send("ready_for_pickup")}><CircleDollarSign size={16} /> Ready + payment</button>
          <button type="button" disabled={!selected || saving} onClick={() => void send("checkout")}><CheckCircle2 size={16} /> Checkout + discharge</button>
          <button type="button" disabled={!selected || saving} onClick={() => void send("appointment_changed")}><CalendarX2 size={16} /> Cancel stale reminders</button>
        </div>
        {notice ? <p className="staffJourneyNotice"><Send size={14} /> {notice}</p> : null}
      </div>

      <div className="staffJourneyQueue">
        <div><BellRing size={16} /><strong>Message queue</strong><span>{snapshot.items.length} planned or delivered</span></div>
        {snapshot.items.length === 0 ? <p className="emptyText">No journey messages yet. Choose a client above to queue an update.</p> : snapshot.items.slice(0, 8).map((item, index) => (
          <div className="staffJourneyQueueItem" key={`${item.clientId}-${item.messageType}-${item.scheduledFor}-${index}`}>
            <span className={`journeyChannel journeyChannel--${item.channel}`}>{item.channel === "sms" ? "Text" : item.channel}</span>
            <p><strong>{item.petName} · {messageLabel(item.messageType)}</strong><small>{item.clientName} · {item.body}</small></p>
            <span className={`queueStatus queueStatus--${item.status}`}>{item.status}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
