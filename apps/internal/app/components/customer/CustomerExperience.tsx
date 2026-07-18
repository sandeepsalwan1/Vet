"use client";

import {
  Calendar,
  ClipboardList,
  LogOut,
  PawPrint,
  Pill,
  ShieldCheck,
  Stethoscope,
} from "lucide-react";
import { useCallback } from "react";
import { logout, type AccountSession } from "../../lib/accountStore";
import { ChatPanel } from "../ChatPanel";
import { useClinicBrand } from "../ClinicContext";
import { useCustomerAgentChat } from "./useCustomerAgentChat";
import { ClientJourneyDashboard } from "./ClientJourneyDashboard";

type Props = {
  session: AccountSession;
  onLogout: () => void;
};

const QUICK_ACTIONS = [
  { label: "Book appointment", prompt: "I'd like to book an appointment for my pet", icon: Calendar, color: "customerQuickBtn--blue" },
  { label: "Check in", prompt: "I'm arriving at the clinic and want to check in", icon: ShieldCheck, color: "customerQuickBtn--green" },
  { label: "Prescription refill", prompt: "I need a prescription refill for my pet", icon: Pill, color: "customerQuickBtn--purple" },
  { label: "Pickup status", prompt: "I want to know if my pet is ready for pickup", icon: ClipboardList, color: "customerQuickBtn--teal" },
  { label: "Health concern", prompt: "My pet is unwell and I need some advice", icon: Stethoscope, color: "customerQuickBtn--red" },
] as const;

export function CustomerExperience({ session, onLogout }: Props) {
  const clinic = useClinicBrand();
  const petName = session.petName ?? "your pet";

  const { messages, isLoading, sendMessage } = useCustomerAgentChat(session);

  const handleSend = useCallback(
    async (text: string) => {
      await sendMessage(text);
    },
    [sendMessage]
  );

  function handleLogout() {
    logout();
    onLogout();
  }

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
          <div className="customerChatWrapper customerChatWrapper--primary">
            <ChatPanel
              messages={messages}
              onSend={handleSend}
              isLoading={isLoading}
              placeholder={`Ask about ${petName}'s appointments, prescriptions, check-in…`}
            />
          </div>

          <div className="customerQuickSection customerQuickSection--compact">
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
                    <Icon size={17} strokeWidth={1.8} />
                    <span>{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <ClientJourneyDashboard session={session} />
        </div>
      </main>
    </div>
  );
}
