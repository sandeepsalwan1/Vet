"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ReportSummary } from "../lib/agentClient";
import { ApprovalsList, FollowupsList, HighPriorityTaskList, PricingReportsList } from "./DailyOpsDetails";
import { DailyOpsSummaryView, type DailyOpsSummary } from "./DailyOpsSummaryView";
import { InvoiceList, type InvoiceData } from "./InvoiceList";
import { PricingComparisonsList, type PricingComparison } from "./PricingComparisonsList";

function reportKeyLabel(key: string) {
  if (key === "comparisons") return "Pricing comparisons";
  return key.replace(/_/g, " ");
}

function ReportCardFullRow({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="reportCardRowFull">
      <span className="reportCardKey">{label}</span>
      <div className="reportCardValue">{children}</div>
    </div>
  );
}

function ReportCardScalarRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="reportCardRow">
      <span className="reportCardKey">{label}</span>
      <span className="reportCardValue">
        {typeof value === "object"
          ? <pre className="reportCardJson">{JSON.stringify(value, null, 2)}</pre>
          : String(value)}
      </span>
    </div>
  );
}

function reportDetailRow(key: string, value: unknown) {
  const label = reportKeyLabel(key);
  if (key === "invoices" && Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <InvoiceList invoices={value as InvoiceData[]} />
      </ReportCardFullRow>
    );
  }
  if (key === "summary" && value && typeof value === "object" && !Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <DailyOpsSummaryView summary={value as DailyOpsSummary} />
      </ReportCardFullRow>
    );
  }
  if (key === "approvals" && Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <ApprovalsList approvals={value} />
      </ReportCardFullRow>
    );
  }
  if (key === "followups" && Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <FollowupsList followups={value} />
      </ReportCardFullRow>
    );
  }
  if (key === "highPriority" && Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <HighPriorityTaskList tasks={value} />
      </ReportCardFullRow>
    );
  }
  if (key === "pricingReports" && Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <PricingReportsList reports={value} />
      </ReportCardFullRow>
    );
  }
  if (key === "comparisons" && Array.isArray(value)) {
    return (
      <ReportCardFullRow key={key} label={label}>
        <PricingComparisonsList comparisons={value as PricingComparison[]} />
      </ReportCardFullRow>
    );
  }
  return <ReportCardScalarRow key={key} label={label} value={value} />;
}

export function ChatReportCard({ report }: { report: ReportSummary }) {
  const [expanded, setExpanded] = useState(false);

  const typeLabel = report.reportType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const SKIP_KEYS = new Set(["services", "flagged", "mode", "changedPrices"]);
  const dataEntries = Object.entries(report.data).filter(
    ([k, v]) => v !== null && v !== undefined && !SKIP_KEYS.has(k)
  );

  return (
    <div className="reportCard">
      <div className="reportCardHeader">
        <span className="reportCardType">{typeLabel}</span>
        <span className="reportCardTitle">{report.title}</span>
      </div>
      {report.summary && (
        <p className="reportCardSummary">{report.summary}</p>
      )}
      {dataEntries.length > 0 && (
        <>
          <button
            className="reportCardToggle"
            onClick={() => setExpanded((e) => !e)}
            type="button"
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {expanded ? "Hide details" : "View full report"}
          </button>
          {expanded && (
            <div className="reportCardData">
              {dataEntries.map(([key, value]) => reportDetailRow(key, value))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
