import { listAgentReports } from "@central-vet/db";
import { NextResponse } from "next/server";
import { dbError, noStoreHeaders } from "../_apiResponse";
import {
  requireManagerFromQuery
} from "../_shared";

type ReportRouteOptions = {
  route: string;
  reportType: string;
  loadExtra?: (clinicId: string) => Promise<Record<string, unknown>>;
};

export function createReportGet(options: ReportRouteOptions) {
  return async function GET(request: Request) {
    try {
      const auth = await requireManagerFromQuery(request);
      if ("response" in auth) return auth.response;

      const [reports, extra] = await Promise.all([
        listAgentReports({ clinicId: auth.clinic.clinicId, reportType: options.reportType }),
        options.loadExtra?.(auth.clinic.clinicId) ?? Promise.resolve({})
      ]);
      return NextResponse.json({ ok: true, reports, ...extra }, { headers: noStoreHeaders });
    } catch (error) {
      return dbError(error, { route: options.route });
    }
  };
}
