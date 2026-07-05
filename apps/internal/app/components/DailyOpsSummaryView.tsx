export interface DailyOpsSummary {
  openTasks: number;
  highPriority: number;
  pendingApprovals: number;
  openFollowups: number;
  invoiceReviews: number;
  recentPricingReports?: number;
}

export function DailyOpsSummaryView({ summary }: { summary: DailyOpsSummary }) {
  return (
    <div className="dailyOpsSummaryGrid">
      <div className="dailyOpsSummaryCard">
        <span className="dailyOpsSummaryLabel">Open Tasks</span>
        <span className="dailyOpsSummaryValue">{summary.openTasks}</span>
      </div>
      <div className={`dailyOpsSummaryCard ${summary.highPriority > 0 ? "dailyOpsSummaryCard--urgent" : ""}`}>
        <span className="dailyOpsSummaryLabel">High Priority</span>
        <span className="dailyOpsSummaryValue">{summary.highPriority}</span>
      </div>
      <div className="dailyOpsSummaryCard">
        <span className="dailyOpsSummaryLabel">Pending Approvals</span>
        <span className="dailyOpsSummaryValue">{summary.pendingApprovals}</span>
      </div>
      <div className="dailyOpsSummaryCard">
        <span className="dailyOpsSummaryLabel">Open Follow-ups</span>
        <span className="dailyOpsSummaryValue">{summary.openFollowups}</span>
      </div>
      <div className="dailyOpsSummaryCard">
        <span className="dailyOpsSummaryLabel">Invoice Reviews</span>
        <span className="dailyOpsSummaryValue">{summary.invoiceReviews}</span>
      </div>
      {typeof summary.recentPricingReports === "number" && (
        <div className="dailyOpsSummaryCard">
          <span className="dailyOpsSummaryLabel">Pricing Reports</span>
          <span className="dailyOpsSummaryValue">{summary.recentPricingReports}</span>
        </div>
      )}
    </div>
  );
}
