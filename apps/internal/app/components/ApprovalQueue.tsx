"use client";

import { Check, FileCheck2, Loader2, XCircle } from "lucide-react";
import { canManage } from "../lib/taskWorkflow";
import { useClinicBrand } from "./ClinicContext";
import { useApprovalQueueState } from "./useApprovalQueueState";

export function ApprovalQueue() {
  const clinic = useClinicBrand();
  const { session, approvals, loading, saving, error, decide } = useApprovalQueueState();

  if (!session) {
    return (
      <main className="staffToolShell">
        <section className="staffToolPanel">
          <h1>Approvals</h1>
          <p>Open the staff task board and sign in first.</p>
          <a className="primaryButton" href="/staff">Staff task board</a>
        </section>
      </main>
    );
  }

  if (!canManage(session.role)) {
    return (
      <main className="staffToolShell">
        <section className="staffToolPanel">
          <h1>Approvals</h1>
          <p>VA, Admin, or Veterinarian access is required.</p>
          <a className="primaryButton" href="/staff">Staff task board</a>
        </section>
      </main>
    );
  }

  return (
    <main className="staffToolShell">
      <section className="staffToolPanel">
        <div className="staffToolHeader">
          <FileCheck2 size={28} />
          <div>
            <p>{clinic.name}</p>
            <h1>Approvals</h1>
          </div>
        </div>
        {error ? <div className="errorBox">{error}</div> : null}
        {loading ? <p>Loading approvals...</p> : null}
        <div className="approvalStack">
          {approvals.map((approval) => (
            <article className="approvalItem" key={approval.id}>
              <div>
                <p>{approval.approvalType.replace("_", " ")}</p>
                <h2>{approval.title}</h2>
                <span>{approval.summary}</span>
              </div>
              <div className="approvalActions">
                <button className="completeButton" type="button" disabled={Boolean(saving)} onClick={() => void decide(approval.id, "approved")}>
                  {saving === approval.id ? <Loader2 className="spinIcon" size={16} /> : <Check size={16} />}
                  Approve
                </button>
                <button className="escalateButton" type="button" disabled={Boolean(saving)} onClick={() => void decide(approval.id, "rejected")}>
                  <XCircle size={16} />
                  Reject
                </button>
              </div>
            </article>
          ))}
          {!loading && approvals.length === 0 ? <p>No pending approvals.</p> : null}
        </div>
      </section>
    </main>
  );
}
