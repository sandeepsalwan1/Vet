import { listOpenFollowups } from "@central-vet/db";
import { createReportGet } from "../_reportRoute";

export const dynamic = "force-dynamic";

export const GET = createReportGet({
  route: "reports.followups",
  reportType: "followup",
  loadExtra: async (clinicId) => ({
    followups: await listOpenFollowups({ clinicId })
  })
});
