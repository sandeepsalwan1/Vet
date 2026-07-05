"use client";

import { Loader2, Search } from "lucide-react";
import type { useStaffAgentAudit } from "./useStaffAgentAudit";

type StaffAgentAuditState = ReturnType<typeof useStaffAgentAudit>;

export function StaffAgentAuditPanel({ audit }: { audit: StaffAgentAuditState }) {
  return (
    <div className="staffAgentAudit">
      <section>
        <div className="staffAgentAuditHeader">
          <h2>Decisions</h2>
          <button className="plainButton" type="button" onClick={() => void audit.loadAudit()} disabled={audit.auditLoading}>
            {audit.auditLoading ? <Loader2 className="spinIcon" size={15} /> : <Search size={15} />}
            Refresh
          </button>
        </div>
        {audit.decisions.length > 0 ? (
          <div className="agentEmailResults">
            {audit.decisions.map((decision) => (
              <div key={decision.id}>
                <span>{decision.decisionKind} - {decision.action}</span>
                <strong>{decision.status}</strong>
                <em>{decision.resultSummary || decision.capability}</em>
              </div>
            ))}
          </div>
        ) : (
          <p className="mutedLine">No decisions yet.</p>
        )}
      </section>
      <section>
        <div className="staffAgentAuditHeader">
          <h2>Memory</h2>
        </div>
        <div className="staffMemoryEditor">
          <select value={audit.memorySubjectType} onChange={(event) => audit.setMemorySubjectType(event.target.value)}>
            <option value="client">client</option>
            <option value="pet">pet</option>
            <option value="clinic">clinic</option>
          </select>
          <input
            value={audit.memoryFact}
            onChange={(event) => audit.setMemoryFact(event.target.value)}
            placeholder="Preference or durable fact"
          />
          <button className="plainButton" type="button" disabled={!audit.memoryFact.trim()} onClick={() => void audit.writeMemory("POST")}>
            Add
          </button>
        </div>
        {audit.memories.length > 0 ? (
          <div className="agentEmailResults">
            {audit.memories.map((memory) => (
              <div key={memory.id}>
                <span>{memory.fact}</span>
                <strong>{memory.subjectType}</strong>
                <em>
                  <button className="textButton" type="button" disabled={!audit.memoryFact.trim()} onClick={() => void audit.writeMemory("PATCH", memory.id)}>
                    Correct
                  </button>
                  <button className="textButton dangerTextButton" type="button" onClick={() => void audit.writeMemory("DELETE", memory.id)}>
                    Delete
                  </button>
                </em>
              </div>
            ))}
          </div>
        ) : (
          <p className="mutedLine">No memory yet.</p>
        )}
        {audit.auditError ? <div className="errorBox">{audit.auditError}</div> : null}
      </section>
    </div>
  );
}
