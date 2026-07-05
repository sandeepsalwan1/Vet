import { createReportGet } from "../_reportRoute";

export const dynamic = "force-dynamic";

export const GET = createReportGet({
  route: "reports.invoices",
  reportType: "invoice"
});
