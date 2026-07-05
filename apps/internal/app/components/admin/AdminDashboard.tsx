"use client";

import { Bot, ClipboardList, LayoutDashboard, LogOut, Users } from "lucide-react";
import { useState } from "react";
import { logout, type AccountSession } from "../../lib/accountStore";
import { ChatPanel } from "../ChatPanel";
import { useClinicBrand } from "../ClinicContext";
import { AdminTasksTab } from "./AdminTasksTab";
import { TeamAccountPanel } from "./TeamAccountPanel";
import { useAdminAssistantChat } from "./useAdminAssistantChat";
import { useAdminTaskSnapshot } from "./useAdminTaskSnapshot";

type AdminSession = AccountSession & { role: "admin" };

type Props = {
  session: AdminSession;
  onLogout: () => void;
  onOpenBoard: () => void;
};

type Tab = "tasks" | "assistant" | "team";

export function AdminDashboard({ session, onLogout, onOpenBoard }: Props) {
  const clinic = useClinicBrand();
  const [tab, setTab] = useState<Tab>("tasks");

  const {
    activeTasks,
    clearNewTaskCount,
    loading: tasksLoading,
    newTaskCount,
    refreshing: tasksRefreshing,
    refreshTasks,
    stats
  } = useAdminTaskSnapshot(session);

  const {
    messages,
    isLoading,
    quickLoading,
    sendMessage,
    runQuickAction
  } = useAdminAssistantChat({
    session,
    onTasksChanged: refreshTasks
  });

  function fireQuickAction(intent: string, label: string) {
    setTab("assistant");
    void runQuickAction(intent, label);
  }

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
    <div className="vetShell">
      <header className="vetHeader">
        <div className="vetHeaderLeft">
          <ShieldMark />
          <div>
            <p className="vetHeaderEyebrow">{clinic.name}</p>
            <h1 className="vetHeaderTitle">{session.name}</h1>
          </div>
        </div>
        <div className="vetHeaderRight">
          <span className="vetHeaderDate">{today}</span>
          <button className="plainButton adminBoardBtn" onClick={onOpenBoard} title="Open the full task board">
            <LayoutDashboard size={16} />
            Task Board
          </button>
          <button className="iconButton" onClick={handleLogout} title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="adminDashTabs">
        <button
          className={`adminDashTab${tab === "tasks" ? " adminDashTab--active" : ""}`}
          onClick={() => { setTab("tasks"); clearNewTaskCount(); }}
          type="button"
        >
          <ClipboardList size={15} />
          Tasks
          {newTaskCount > 0 && tab !== "tasks" && <span className="adminDashTabBadge">+{newTaskCount}</span>}
        </button>
        <button
          className={`adminDashTab${tab === "assistant" ? " adminDashTab--active" : ""}`}
          onClick={() => setTab("assistant")}
          type="button"
        >
          <Bot size={15} />
          AI Assistant
        </button>
        <button
          className={`adminDashTab${tab === "team" ? " adminDashTab--active" : ""}`}
          onClick={() => setTab("team")}
          type="button"
        >
          <Users size={15} />
          Team
        </button>
      </div>

      {tab === "tasks" && (
        <AdminTasksTab
          activeTasks={activeTasks}
          assistantLoading={isLoading}
          loading={tasksLoading}
          quickLoading={quickLoading}
          refreshing={tasksRefreshing}
          stats={stats}
          onRefreshTasks={refreshTasks}
          onRunQuickAction={fireQuickAction}
        />
      )}

      {tab === "assistant" && (
        <div className="adminAssistantWrap">
          <ChatPanel
            messages={messages}
            onSend={(text) => void sendMessage(text)}
            isLoading={isLoading}
            placeholder="Ask for a daily digest, records, invoices, pricing…"
          />
        </div>
      )}

      {tab === "team" && (
        <TeamAccountPanel session={session} onLogout={handleLogout} onOpenTaskBoard={onOpenBoard} embedded />
      )}
    </div>
  );
}

function ShieldMark() {
  return <Users size={22} strokeWidth={1.8} />;
}
