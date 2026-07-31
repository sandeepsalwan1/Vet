import { AlertTriangle, BellRing, Calendar, Clock, Search } from "lucide-react";
import type { ReactNode } from "react";

// ── Types ───────────────────────────────────────────────────────────────────

interface ApprovalData {
  id: string;
  runId?: string;
  title: string;
  status: string;
  summary: string;
  createdAt: string;
}

interface FollowupData {
  id: string;
  clientId: string;
  petId: string;
  followupType: string;
  dueDate: string;
  recommendedAction: string;
  status: string;
}

interface TaskData {
  id: string;
  clientName: string | null;
  petName: string | null;
  request: string;
  priority: string;
  status: string;
  dueDate: string;
  dueTime: string;
}

interface PricingReportData {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
}

// ── Renderers ───────────────────────────────────────────────────────────────

const OPS_DETAIL_DATE_OPTIONS = {
  month: "short",
  day: "numeric",
} as const;

function formatOpsDetailDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", OPS_DETAIL_DATE_OPTIONS);
}

function OpsDetailItem({
  className,
  icon,
  title,
  date,
  body,
  badge,
}: {
  className: string;
  icon: ReactNode;
  title: ReactNode;
  date: ReactNode;
  body: ReactNode;
  badge: ReactNode;
}) {
  return (
    <div className={className}>
      <div className="opsDetailHeader">
        <div className="opsDetailTitleGroup">
          {icon}
          <span className="opsDetailTitle">{title}</span>
        </div>
        <span className="opsDetailDate">{date}</span>
      </div>
      <div className="opsDetailBody">
        <p className="opsDetailText">{body}</p>
        {badge}
      </div>
    </div>
  );
}

export function ApprovalsList({ approvals }: { approvals: ApprovalData[] }) {
  if (!approvals || approvals.length === 0) {
    return <p className="noDetailsNote">No pending approvals.</p>;
  }

  return (
    <div className="opsDetailList">
      {approvals.map((a) => (
        <OpsDetailItem
          key={a.id}
          className="opsDetailItem opsDetailItem--approval"
          icon={<BellRing size={13} className="opsDetailIcon opsDetailIcon--bell" />}
          title={a.title}
          date={formatOpsDetailDate(a.createdAt)}
          body={a.summary}
          badge={<span className="opsDetailBadge opsDetailBadge--pending">{a.status}</span>}
        />
      ))}
    </div>
  );
}

export function FollowupsList({ followups }: { followups: FollowupData[] }) {
  if (!followups || followups.length === 0) {
    return <p className="noDetailsNote">No open follow-ups.</p>;
  }

  return (
    <div className="opsDetailList">
      {followups.map((f) => {
        const typeLabel = f.followupType
          .replace(/_/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase());
        return (
          <OpsDetailItem
            key={f.id}
            className="opsDetailItem opsDetailItem--followup"
            icon={<Calendar size={13} className="opsDetailIcon opsDetailIcon--calendar" />}
            title={typeLabel}
            date={`Due ${f.dueDate}`}
            body={f.recommendedAction}
            badge={<span className="opsDetailBadge opsDetailBadge--open">{f.status}</span>}
          />
        );
      })}
    </div>
  );
}

export function HighPriorityTaskList({ tasks }: { tasks: TaskData[] }) {
  if (!tasks || tasks.length === 0) {
    return <p className="noDetailsNote">No high-priority tasks pending.</p>;
  }

  return (
    <div className="opsDetailList">
      {tasks.map((t) => (
        <OpsDetailItem
          key={t.id}
          className="opsDetailItem opsDetailItem--task"
          icon={<AlertTriangle size={13} className="opsDetailIcon opsDetailIcon--alert" />}
          title={`${t.petName || "Pet"} (${t.clientName || "Client"})`}
          date={
            <>
              <Clock size={11} style={{ marginRight: "2px", verticalAlign: "middle" }} />
              {t.dueTime}
            </>
          }
          body={t.request}
          badge={<span className="opsDetailBadge opsDetailBadge--urgent">high priority</span>}
        />
      ))}
    </div>
  );
}

export function PricingReportsList({ reports }: { reports: PricingReportData[] }) {
  if (!reports || reports.length === 0) {
    return <p className="noDetailsNote">No recent pricing reports.</p>;
  }

  return (
    <div className="opsDetailList">
      {reports.map((r) => (
        <OpsDetailItem
          key={r.id}
          className="opsDetailItem opsDetailItem--pricing"
          icon={<Search size={13} className="opsDetailIcon opsDetailIcon--search" />}
          title={r.title}
          date={formatOpsDetailDate(r.createdAt)}
          body={r.summary}
          badge={<span className="opsDetailBadge opsDetailBadge--pricing">Pricing</span>}
        />
      ))}
    </div>
  );
}
