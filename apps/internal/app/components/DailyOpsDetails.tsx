import { AlertTriangle, BellRing, Calendar, Clock, Search } from "lucide-react";

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

export function ApprovalsList({ approvals }: { approvals: ApprovalData[] }) {
  if (!approvals || approvals.length === 0) {
    return <p className="noDetailsNote">No pending approvals.</p>;
  }

  return (
    <div className="opsDetailList">
      {approvals.map((a) => (
        <div key={a.id} className="opsDetailItem opsDetailItem--approval">
          <div className="opsDetailHeader">
            <div className="opsDetailTitleGroup">
              <BellRing size={13} className="opsDetailIcon opsDetailIcon--bell" />
              <span className="opsDetailTitle">{a.title}</span>
            </div>
            <span className="opsDetailDate">
              {new Date(a.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="opsDetailBody">
            <p className="opsDetailText">{a.summary}</p>
            <span className="opsDetailBadge opsDetailBadge--pending">{a.status}</span>
          </div>
        </div>
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
          <div key={f.id} className="opsDetailItem opsDetailItem--followup">
            <div className="opsDetailHeader">
              <div className="opsDetailTitleGroup">
                <Calendar size={13} className="opsDetailIcon opsDetailIcon--calendar" />
                <span className="opsDetailTitle">{typeLabel}</span>
              </div>
              <span className="opsDetailDate">Due {f.dueDate}</span>
            </div>
            <div className="opsDetailBody">
              <p className="opsDetailText">{f.recommendedAction}</p>
              <span className="opsDetailBadge opsDetailBadge--open">{f.status}</span>
            </div>
          </div>
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
        <div key={t.id} className="opsDetailItem opsDetailItem--task">
          <div className="opsDetailHeader">
            <div className="opsDetailTitleGroup">
              <AlertTriangle size={13} className="opsDetailIcon opsDetailIcon--alert" />
              <span className="opsDetailTitle">
                {t.petName || "Pet"} ({t.clientName || "Client"})
              </span>
            </div>
            <span className="opsDetailDate">
              <Clock size={11} style={{ marginRight: "2px", verticalAlign: "middle" }} />
              {t.dueTime}
            </span>
          </div>
          <div className="opsDetailBody">
            <p className="opsDetailText">{t.request}</p>
            <span className="opsDetailBadge opsDetailBadge--urgent">high priority</span>
          </div>
        </div>
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
        <div key={r.id} className="opsDetailItem opsDetailItem--pricing">
          <div className="opsDetailHeader">
            <div className="opsDetailTitleGroup">
              <Search size={13} className="opsDetailIcon opsDetailIcon--search" />
              <span className="opsDetailTitle">{r.title}</span>
            </div>
            <span className="opsDetailDate">
              {new Date(r.createdAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="opsDetailBody">
            <p className="opsDetailText">{r.summary}</p>
            <span className="opsDetailBadge opsDetailBadge--pricing">Pricing</span>
          </div>
        </div>
      ))}
    </div>
  );
}
