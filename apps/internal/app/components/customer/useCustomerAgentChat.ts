"use client";

import { useMemo } from "react";
import { sendCustomerMessage, type CustomerContext } from "../../lib/agentClient";
import type { AccountSession } from "../../lib/accountStore";
import { useAgentChatSession } from "../useAgentChatSession";

export function useCustomerAgentChat(session: AccountSession) {
  const firstName = session.name.split(" ")[0];
  const petName = session.petName ?? "your pet";
  const context: CustomerContext = useMemo(() => ({
    name: session.name,
    phone: session.phone,
    petName: session.petName
  }), [session.name, session.petName, session.phone]);

  return useAgentChatSession({
    context,
    initialAssistantMessage:
      `Hi ${firstName}. I can book a visit, handle a refill, check you in, or pull up ${petName}'s records. What do you need?`,
    failureMessage: "I'm having trouble connecting right now. Please try again in a moment.",
    send: sendCustomerMessage
  });
}
