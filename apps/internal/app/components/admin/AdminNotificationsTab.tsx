"use client";

import type { StaffClientJourneySnapshot } from "@central-vet/db";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Mail,
  MessageSquareText,
  ShieldCheck
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AccountSession } from "../../lib/accountStore";
import { readStaffClientJourney } from "../staffJourneyClient";
import { taskBoardActorQuery } from "../taskBoardClient";
import type { TaskBoardSession } from "../taskBoardTypes";

type AdminSession = AccountSession & { role: "admin" };

function channelLabel(channel: string) {
  if (channel === "sms") return "Text";
  return channel.charAt(0).toUpperCase() + channel.slice(1);
}

function messageLabel(value: string) {
  return value.replaceAll("_", " ");
}

function timeLabel(value: string) {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

export function AdminNotificationsTab({ session }: { session: AdminSession }) {
  const [snapshot, setSnapshot] = useState<StaffClientJourneySnapshot | null>(null);
  const [error, setError] = useState("");
  const actor = useMemo<TaskBoardSession>(() => ({
    name: session.name,
    role: "admin",
    passcode: session.passcode
  }), [session.name, session.passcode]);
  const actorQuery = useMemo(() => taskBoardActorQuery(actor), [actor]);

  const load = useCallback(async () => {
    try {
      setSnapshot(await readStaffClientJourney(actor, actorQuery));
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Notification details are unavailable.");
    }
  }, [actor, actorQuery]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  if (!snapshot) {
    return (
      <section className="adminNotifications adminNotifications--loading">
        <BellRing size={20} />
        <p>{error || "Loading notification rules…"}</p>
        {error ? <button type="button" onClick={() => void load()}>Try again</button> : null}
      </section>
    );
  }

  const { settings } = snapshot;
  const steps = [
    {
      title: "Appointment booked",
      detail: settings.confirmationEmailEnabled ? "Confirmation email sends immediately." : "Confirmation email is currently off.",
      meta: "Email"
    },
    {
      title: "Prepare for the visit",
      detail: `Detailed email ${settings.reminderEmailHours} hours before.${settings.reminderSmsEnabled ? ` Consented clients also get a text ${settings.reminderSmsHours} hours before.` : " Text reminders are currently off."}`,
      meta: settings.reminderSmsEnabled ? "Email + optional text" : "Email"
    },
    {
      title: "During the visit",
      detail: "The care team sends concise updates only when there is useful news.",
      meta: "Text if consented"
    },
    {
      title: "Pickup and discharge",
      detail: "Ready and payment notice first. Doctor-approved discharge instructions follow checkout.",
      meta: "Text, then email"
    },
    {
      title: "After the visit",
      detail: `Visit feedback sends after ${settings.feedbackDelayMinutes} minutes. A positive response schedules the ${settings.petCheckDelayHours}-hour pet check; a concern creates a staff follow-up task instead.`,
      meta: "Automatic follow-up"
    }
  ];

  return (
    <main className="adminNotifications">
      <header className="adminNotificationsHeader">
        <div>
          <p className="vetHeaderEyebrow">Client communication</p>
          <h2>How notifications move through a visit</h2>
          <p>Automatic where timing is predictable. Human-triggered where care context matters.</p>
        </div>
        <span className="adminNotificationSafety"><ShieldCheck size={15} /> Consent and quiet hours enforced</span>
      </header>

      <section className="adminNotificationFlow" aria-label="Notification journey">
        {steps.map((step, index) => (
          <article className="adminNotificationStep" key={step.title}>
            <span className="adminNotificationStepNumber">{index + 1}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
              <small>{step.meta}</small>
            </div>
          </article>
        ))}
      </section>

      <section className="adminNotificationRules">
        <div className="adminNotificationRule">
          <Mail size={18} />
          <span><strong>Email carries detail</strong><small>Preparation, invoices, and discharge instructions</small></span>
        </div>
        <div className="adminNotificationRule">
          <MessageSquareText size={18} />
          <span><strong>Texts stay selective</strong><small>Only with consent; reminders cancel when appointments change</small></span>
        </div>
        <div className="adminNotificationRule">
          <Clock3 size={18} />
          <span><strong>Quiet hours</strong><small>{settings.quietHoursStart} to {settings.quietHoursEnd} · {settings.timeZone}</small></span>
        </div>
      </section>

      <section className="adminNotificationRecent">
        <div className="adminNotificationRecentHeader">
          <div>
            <p className="vetHeaderEyebrow">Delivery activity</p>
            <h3>Recent messages</h3>
          </div>
          <span>{snapshot.items.length} total</span>
        </div>
        {snapshot.items.length === 0 ? (
          <p className="adminNotificationEmpty">No client messages yet.</p>
        ) : (
          <div className="adminNotificationList">
            {snapshot.items.slice(0, 6).map((item, index) => (
              <div className="adminNotificationMessage" key={`${item.clientId}-${item.messageType}-${item.scheduledFor}-${index}`}>
                <span className={`adminNotificationChannel adminNotificationChannel--${item.channel}`}>{channelLabel(item.channel)}</span>
                <span className="adminNotificationMessageName"><strong>{item.petName}</strong><small>{messageLabel(item.messageType)}</small></span>
                <span className="adminNotificationMessageTime">{timeLabel(item.scheduledFor)}</span>
                <span className={`adminNotificationStatus adminNotificationStatus--${item.status}`}><CheckCircle2 size={13} /> {item.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
