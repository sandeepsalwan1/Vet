"use client";

import { useState } from "react";
import { ChatPanel, type ChatMessage } from "../../components/ChatPanel";

export function DogEggProofView() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Type the hidden phrase in the chat and press Enter.",
      timestamp: new Date()
    }
  ]);

  return (
    <main className="customerShell">
      <section className="customerMain">
        <div className="customerContent">
          <div className="customerChatWrapper customerChatWrapper--primary">
            <ChatPanel
              messages={messages}
              onSend={(text) => {
                setMessages((current) => [
                  ...current,
                  { id: `msg-${current.length + 1}`, role: "user", content: text, timestamp: new Date() }
                ]);
              }}
              placeholder="Type a message…"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
