"use client";

import type { Task } from "@central-vet/db";
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ClipboardList,
  Clock,
  FileCheck2,
  Loader2,
  ReceiptText,
  RefreshCw,
  Search
} from "lucide-react";
import type { TaskBoardStats } from "../taskBoardDisplay";

type AdminTasksTabProps = {
  activeTasks: Task[];
  assistantLoading: boolean;
  loading: boolean;
  quickLoading: string;
  refreshing: boolean;
  stats: TaskBoardStats | null;
  onRefreshTasks: (manual?: boolean) => void | Promise<void>;
  onRunQuickAction: (intent: string, label: string) => void;
};

const quickActions = [
  { intent: "daily_ops", label: "Daily ops", icon: ClipboardList },
  { intent: "pricing", label: "Pricing scan", icon: Search },
  { intent: "invoice", label: "Invoice review", icon: ReceiptText },
  { intent: "records", label: "Records", icon: FileCheck2 }
] as const;

const priorityMeta: Record<string, { label: string; cls: string }> = {
  high: { label: "High", cls: "vetPriorityBadge vetPriorityBadge--high" },
  medium: { label: "Medium", cls: "vetPriorityBadge vetPriorityBadge--medium" },
  low: { label: "Low", cls: "vetPriorityBadge vetPriorityBadge--low" }
};

const statusMeta: Record<string, { label: string; cls: string }> = {
  due: { label: "Due", cls: "vetStatusBadge vetStatusBadge--due" },
  pending_review: { label: "Pending Review", cls: "vetStatusBadge vetStatusBadge--review" },
  completed: { label: "Completed", cls: "vetStatusBadge vetStatusBadge--done" }
};

export function AdminTasksTab({
  activeTasks,
  assistantLoading,
  loading,
  quickLoading,
  refreshing,
  stats,
  onRefreshTasks,
  onRunQuickAction
}: AdminTasksTabProps) {
  const statCards = stats
    ? [
        { label: "Due Today", value: stats.dueToday, icon: Clock, colorClass: "statCard--blue", urgent: stats.dueTodayUrgent },
        { label: "Pending Review", value: stats.pendingReview, icon: ClipboardList, colorClass: "statCard--amber", urgent: stats.pendingReviewUrgent },
        { label: "Escalated", value: stats.escalated, icon: BellRing, colorClass: "statCard--red", urgent: stats.escalatedUrgent },
        { label: "Completed", value: stats.completed, icon: CheckCircle2, colorClass: "statCard--green", urgent: 0 }
      ]
    : [];

  return (
    <div className="vetContent">
      <div className="vetMain">
        {loading ? (
          <div className="vetStats">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="statCard statCard--loading" />
            ))}
          </div>
        ) : (
          <div className="vetStats">
            {statCards.map((stat) => {
              const Icon = stat.icon;
              return (
                <div key={stat.label} className={`statCard ${stat.colorClass}`}>
                  <div className="statCardHeader">
                    <Icon size={18} />
                    <span className="statCardLabel">{stat.label}</span>
                  </div>
                  <div className="statCardValue">{stat.value}</div>
                  {stat.urgent > 0 && (
                    <div className="statCardUrgent">
                      <AlertTriangle size={12} />
                      {stat.urgent} urgent
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="vetQuickBar">
          <span className="vetQuickBarLabel">Agent</span>
          {quickActions.map((action) => {
            const Icon = action.icon;
            const actionLoading = quickLoading === action.intent;
            return (
              <button
                key={action.intent}
                className="vetQuickBtn"
                disabled={Boolean(quickLoading) || assistantLoading}
                onClick={() => onRunQuickAction(action.intent, action.label)}
                title={`Run ${action.label}`}
              >
                {actionLoading ? <Loader2 size={14} className="spinIcon" /> : <Icon size={14} />}
                {action.label}
              </button>
            );
          })}
        </div>

        <div className="vetTaskPanel">
          <div className="vetTaskPanelHeader">
            <h2>
              <ClipboardList size={18} />
              Today&apos;s Queue
            </h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {!loading && <span className="vetTaskPanelCount">{activeTasks.length} tasks</span>}
              <button
                className={`vetRefreshBtn${refreshing ? " vetRefreshBtn--spinning" : ""}`}
                onClick={() => void onRefreshTasks(true)}
                title="Refresh queue"
                type="button"
              >
                <RefreshCw size={13} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="vetTaskListLoading">
              <Loader2 size={20} className="spinIcon" />
              <span>Loading tasks...</span>
            </div>
          ) : activeTasks.length === 0 ? (
            <p className="vetTaskPanelNote">No active tasks right now.</p>
          ) : (
            <div className="vetTaskList">
              {activeTasks.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TaskItem({ task }: { task: Task }) {
  const p = priorityMeta[task.priority] ?? priorityMeta.low;
  const s = statusMeta[task.status] ?? { label: task.status, cls: "vetStatusBadge" };
  const isEscalated = Boolean(task.escalatedAt);
  const time = task.dueTime
    ? new Date(`${task.dueDate}T${task.dueTime}`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
      })
    : new Date(task.createdAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit"
      });

  return (
    <div className={`vetTaskRow${isEscalated ? " vetTaskRow--escalated" : ""}`}>
      <div className="vetTaskRowMain">
        {isEscalated && <BellRing size={14} className="vetEscalateIcon" />}
        <div className="vetTaskRowPet">{task.petName ?? "No pet"}</div>
        <div className="vetTaskRowClient">{task.clientName ?? "No client"}</div>
      </div>
      <div className="vetTaskRowRequest">{task.request}</div>
      <div className="vetTaskRowMeta">
        <span className={p.cls}>{p.label}</span>
        <span className={s.cls}>{s.label}</span>
        <span className="vetTaskRowTime">{time}</span>
      </div>
    </div>
  );
}
