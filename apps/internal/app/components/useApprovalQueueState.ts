"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  decideApprovalQueueItem,
  readApprovalQueue,
  type ApprovalQueueItem
} from "./approvalQueueClient";
import { readStoredTaskBoardSession } from "./taskBoardBrowserState";
import type { TaskBoardSession as Session } from "./taskBoardTypes";

export function useApprovalQueueState() {
  const [session, setSession] = useState<Session | null>(null);
  const [approvals, setApprovals] = useState<ApprovalQueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const id = window.setTimeout(() => {
      setSession(readStoredTaskBoardSession());
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  const actor = useMemo(() => {
    if (!session) return null;
    return {
      name: session.name,
      role: session.role,
      passcode: session.passcode,
      profileId: session.profileId
    };
  }, [session]);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError("");
    try {
      setApprovals(await readApprovalQueue(session));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Load failed.");
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const decide = useCallback(async (id: string, status: "approved" | "rejected") => {
    if (!actor) return;
    setSaving(id);
    setError("");
    try {
      await decideApprovalQueueItem(actor, id, status);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed.");
    } finally {
      setSaving("");
    }
  }, [actor, load]);

  return {
    session,
    approvals,
    loading,
    saving,
    error,
    decide
  };
}
