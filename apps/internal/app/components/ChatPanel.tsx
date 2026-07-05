"use client";

import { AlertCircle, Bot, CheckCircle2, Clock, Send, ShieldAlert, User } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import type { ReportSummary, WorkflowStatus } from "../lib/agentClient";
import { ChatReportCard } from "./ChatReportCard";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: WorkflowStatus;
  timestamp: Date;
  taskIds?: string[];
  approvalIds?: string[];
  report?: ReportSummary;
};

type Props = {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  isLoading?: boolean;
  placeholder?: string;
  className?: string;
};

const statusMeta: Record<WorkflowStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  running: { label: "Running", icon: <Clock size={12} />, cls: "agentChip agentChip--running" },
  needs_approval: { label: "Needs approval", icon: <ShieldAlert size={12} />, cls: "agentChip agentChip--approval" },
  completed: { label: "Completed", icon: <CheckCircle2 size={12} />, cls: "agentChip agentChip--done" },
  failed: { label: "Failed", icon: <AlertCircle size={12} />, cls: "agentChip agentChip--failed" },
};

function StatusChip({ status }: { status: WorkflowStatus }) {
  const meta = statusMeta[status];
  return (
    <span className={meta.cls}>
      {meta.icon}
      {meta.label}
    </span>
  );
}

function formatMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br />");
}

export function ChatPanel({ messages, onSend, isLoading, placeholder, className }: Props) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    onSend(trimmed);
    setInput("");
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const trimmed = input.trim();
      if (trimmed && !isLoading) {
        onSend(trimmed);
        setInput("");
      }
    }
  }

  return (
    <div className={`chatContainer${className ? ` ${className}` : ""}`}>
      <div className="chatMessages">
        {messages.length === 0 && (
          <div className="chatEmpty">
            <Bot size={32} />
            <p>Ask about visits, refills, or records.</p>
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`chatMessage chatMessage--${msg.role}`}>
            <div className="chatAvatar">
              {msg.role === "user" ? <User size={16} /> : <Bot size={16} />}
            </div>
            <div className="chatBubbleWrapper">
              <div
                className="chatBubble"
                dangerouslySetInnerHTML={{ __html: formatMarkdown(msg.content) }}
              />
              {msg.report && <ChatReportCard report={msg.report} />}
              {msg.taskIds?.length ? (
                <div className="chatMeta">
                  <span className="agentChip agentChip--done">
                    <CheckCircle2 size={12} />
                    Dashboard action
                  </span>
                  <span className="chatApprovalNote">{msg.taskIds.join(", ")}</span>
                </div>
              ) : null}
              {msg.approvalIds?.length ? (
                <div className="chatMeta">
                  <span className="agentChip agentChip--approval">
                    <ShieldAlert size={12} />
                    Checkpoint queued
                  </span>
                  <span className="chatApprovalNote">{msg.approvalIds.join(", ")}</span>
                </div>
              ) : null}
              {msg.status && msg.status !== "completed" && (
                <div className="chatMeta">
                  <StatusChip status={msg.status} />
                  {msg.status === "needs_approval" && (
                    <span className="chatApprovalNote">
                      Automation checkpoint pending.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
          <div className="chatMessage chatMessage--assistant">
            <div className="chatAvatar">
              <Bot size={16} />
            </div>
            <div className="chatBubbleWrapper">
              <div className="chatBubble chatBubble--loading">
                <span className="typingDot" />
                <span className="typingDot" />
                <span className="typingDot" />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chatComposer" onSubmit={handleSubmit}>
        <textarea
          ref={textareaRef}
          className="chatInput"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder ?? "Type a message… (Enter to send)"}
          rows={1}
          disabled={isLoading}
        />
        <button
          className="chatSendButton"
          type="submit"
          disabled={!input.trim() || isLoading}
          aria-label="Send message"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}
