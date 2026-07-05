"use client";

import { useCallback, useEffect, useState } from "react";
import {
  readAgentAudit,
  writeAgentMemory,
  type AgentDecisionRow,
  type AgentMemoryRow
} from "../lib/agentAuditClient";
import { canManage } from "../lib/taskWorkflow";

type StaffAgentActor = Parameters<typeof readAgentAudit>[0];

export function useStaffAgentAudit(actor: StaffAgentActor | null) {
  const [decisions, setDecisions] = useState<AgentDecisionRow[]>([]);
  const [memories, setMemories] = useState<AgentMemoryRow[]>([]);
  const [memoryFact, setMemoryFact] = useState("");
  const [memorySubjectType, setMemorySubjectType] = useState("client");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");

  const loadAudit = useCallback(async () => {
    if (!actor) return;
    setAuditLoading(true);
    setAuditError("");
    try {
      const audit = await readAgentAudit(actor);
      setDecisions(audit.decisions);
      setMemories(audit.memories);
    } catch (auditLoadError) {
      setAuditError(auditLoadError instanceof Error ? auditLoadError.message : "Audit load failed.");
    } finally {
      setAuditLoading(false);
    }
  }, [actor]);

  useEffect(() => {
    if (!actor || !canManage(actor.role)) return;
    const auditTimer = window.setTimeout(() => {
      void loadAudit();
    }, 0);
    return () => window.clearTimeout(auditTimer);
  }, [actor, loadAudit]);

  const writeMemory = useCallback(async (method: "POST" | "PATCH" | "DELETE", id?: string) => {
    if (!actor) return;
    setAuditError("");
    try {
      await writeAgentMemory(actor, {
        method,
        id,
        subjectType: memorySubjectType,
        fact: memoryFact,
        memoryType: "preference"
      });
      setMemoryFact("");
      await loadAudit();
    } catch (memoryError) {
      setAuditError(memoryError instanceof Error ? memoryError.message : "Memory update failed.");
    }
  }, [actor, loadAudit, memoryFact, memorySubjectType]);

  return {
    auditError,
    auditLoading,
    decisions,
    loadAudit,
    memories,
    memoryFact,
    memorySubjectType,
    setMemoryFact,
    setMemorySubjectType,
    writeMemory
  };
}
