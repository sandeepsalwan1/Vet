"use client";

import { useCallback, useState } from "react";
import type { ChatMessage } from "./ChatPanel";

type AgentChatResponse = {
  message: string;
  status: ChatMessage["status"];
  taskIds?: string[];
  approvalIds?: string[];
  report?: ChatMessage["report"];
};

type UseAgentChatSessionArgs<TContext> = {
  context: TContext;
  initialAssistantMessage: string;
  failureMessage: string;
  send(context: TContext, text: string, intent?: string): Promise<AgentChatResponse>;
  onCompleted?(): void | Promise<void>;
};

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function useAgentChatSession<TContext>({
  context,
  initialAssistantMessage,
  failureMessage,
  send,
  onCompleted
}: UseAgentChatSessionArgs<TContext>) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    {
      id: uid(),
      role: "assistant",
      content: initialAssistantMessage,
      status: "completed",
      timestamp: new Date()
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = useCallback(async (text: string, intent?: string) => {
    setMessages((prev) => [
      ...prev,
      {
        id: uid(),
        role: "user",
        content: text,
        timestamp: new Date()
      }
    ]);
    setIsLoading(true);

    try {
      const response = await send(context, text, intent);
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: response.message,
          status: response.status,
          taskIds: response.taskIds,
          approvalIds: response.approvalIds,
          report: response.report,
          timestamp: new Date()
        }
      ]);
      try {
        void onCompleted?.();
      } catch {
        /* Post-send refreshes must not turn delivered chat into failed chat. */
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: "assistant",
          content: failureMessage,
          status: "failed",
          timestamp: new Date()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [context, failureMessage, onCompleted, send]);

  return {
    messages,
    isLoading,
    sendMessage
  };
}
