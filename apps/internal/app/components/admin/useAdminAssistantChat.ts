"use client";

import { useCallback, useState } from "react";
import { sendVetMessage } from "../../lib/agentClient";
import { useAgentChatSession } from "../useAgentChatSession";

type AdminAssistantSession = Parameters<typeof sendVetMessage>[0];

type UseAdminAssistantChatArgs = {
  session: AdminAssistantSession;
  onTasksChanged(): void | Promise<void>;
};

export function useAdminAssistantChat({
  session,
  onTasksChanged
}: UseAdminAssistantChatArgs) {
  const { messages, isLoading, sendMessage } = useAgentChatSession({
    context: session,
    initialAssistantMessage:
      "I'm the clinic assistant. I can see tasks, approvals, records, invoices, and pricing. Ask for a daily ops digest or anything you want to look into.",
    failureMessage: "Connection issue. Please try again.",
    send: sendVetMessage,
    onCompleted: onTasksChanged
  });
  const [quickLoading, setQuickLoading] = useState("");

  const runQuickAction = useCallback(async (intent: string, label: string) => {
    setQuickLoading(intent);
    try {
      await sendMessage(label, intent);
    } finally {
      setQuickLoading("");
    }
  }, [sendMessage]);

  return {
    messages,
    isLoading,
    quickLoading,
    sendMessage,
    runQuickAction
  };
}
