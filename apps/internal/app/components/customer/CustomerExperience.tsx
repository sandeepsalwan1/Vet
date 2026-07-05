"use client";

import {
  Calendar,
  ClipboardList,
  FileText,
  LogOut,
  Mail,
  PawPrint,
  Phone,
  Pill,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useCallback, useState } from "react";
import { logout, type AccountSession } from "../../lib/accountStore";
import { ChatPanel } from "../ChatPanel";
import { useClinicBrand } from "../ClinicContext";
import { useCustomerAgentChat } from "./useCustomerAgentChat";

type Props = {
  session: AccountSession;
  onLogout: () => void;
};

const QUICK_ACTIONS = [
  { label: "Book appointment", prompt: "I'd like to book an appointment for my pet", icon: Calendar, color: "customerQuickBtn--blue" },
  { label: "Check in", prompt: "I'm arriving at the clinic and want to check in", icon: ShieldCheck, color: "customerQuickBtn--green" },
  { label: "Prescription refill", prompt: "I need a prescription refill for my pet", icon: Pill, color: "customerQuickBtn--purple" },
  { label: "Pet records", prompt: "I'd like to access my pet's medical records", icon: FileText, color: "customerQuickBtn--amber" },
  { label: "Pickup status", prompt: "I want to know if my pet is ready for pickup", icon: ClipboardList, color: "customerQuickBtn--teal" },
  { label: "Health concern", prompt: "My pet is unwell and I need some advice", icon: Stethoscope, color: "customerQuickBtn--red" },
] as const;

export function CustomerExperience({ session, onLogout }: Props) {
  const clinic = useClinicBrand();
  const firstName = session.name.split(" ")[0];
  const petName = session.petName ?? "your pet";

  const { messages, isLoading, sendMessage } = useCustomerAgentChat(session);
  const [chatStarted, setChatStarted] = useState(false);

  const handleSend = useCallback(
    async (text: string) => {
      setChatStarted(true);
      await sendMessage(text);
    },
    [sendMessage]
  );

  function handleLogout() {
    logout();
    onLogout();
  }

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="customerShell">
      {/* Header */}
      <header className="customerHeader">
        <div className="customerHeaderBrand">
          <PawPrint size={20} strokeWidth={2} />
          <span className="customerHeaderName">{clinic.shortName}</span>
        </div>
        <div className="customerHeaderUser">
          <div className="customerHeaderUserInfo">
            <span className="customerHeaderGreeting">{session.name}</span>
            {session.petName && (
              <span className="customerHeaderPet">
                <PawPrint size={10} />
                {session.petName}
              </span>
            )}
          </div>
          <button className="iconButton customerLogoutBtn" onClick={handleLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      <main className="customerMain">
        <div className="customerContent">
          {/* Welcome card */}
          {!chatStarted && (
            <div className="customerWelcomeCard">
              <div className="customerWelcomeLeft">
                <div className="customerWelcomeIcon">
                  <PawPrint size={28} strokeWidth={1.8} />
                </div>
                <div>
                  <h2 className="customerWelcomeTitle">
                    Good to see you, {firstName}!
                  </h2>
                  <p className="customerWelcomeDate">{today}</p>
                  {session.petName && (
                    <p className="customerWelcomePet">
                      Caring for <strong>{session.petName}</strong>
                    </p>
                  )}
                </div>
              </div>
              <div className="customerFacts">
                <div className="customerFact">
                  <span className="customerFactLabel">
                    <PawPrint size={12} /> Pet
                  </span>
                  <span className="customerFactValue">{session.petName ?? "Not added yet"}</span>
                </div>
                <div className="customerFact">
                  <span className="customerFactLabel">
                    <ShieldCheck size={12} /> Owner
                  </span>
                  <span className="customerFactValue">{session.name}</span>
                </div>
                {session.phone && (
                  <div className="customerFact">
                    <span className="customerFactLabel">
                      <Phone size={12} /> Phone
                    </span>
                    <span className="customerFactValue">{session.phone}</span>
                  </div>
                )}
                <div className="customerFact">
                  <span className="customerFactLabel">
                    <Mail size={12} /> Email
                  </span>
                  <span className="customerFactValue">{session.email}</span>
                </div>
              </div>
            </div>
          )}

          {/* Quick actions */}
          {!chatStarted && (
            <div className="customerQuickSection">
              <p className="customerQuickLabel">What can we help with?</p>
              <div className="customerQuickGrid">
                {QUICK_ACTIONS.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.label}
                      className={`customerQuickBtn ${action.color}`}
                      onClick={() => void handleSend(action.prompt)}
                      disabled={isLoading}
                    >
                      <Icon size={18} strokeWidth={1.8} />
                      <span>{action.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Chat */}
          <div className={`customerChatWrapper${chatStarted ? " customerChatWrapper--full" : ""}`}>
            {chatStarted && (
              <div className="customerChatTopBar">
                <button
                  className="customerBackBtn"
                  onClick={() => setChatStarted(false)}
                  type="button"
                >
                  ← Quick actions
                </button>
              </div>
            )}
            <ChatPanel
              messages={messages}
              onSend={handleSend}
              isLoading={isLoading}
              placeholder={`Ask about ${petName}'s appointments, prescriptions, check-in…`}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
