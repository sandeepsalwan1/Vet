"use client";

import type {
  AnalyticsRangeDays,
  ClientAnalyticsSnapshot
} from "@central-vet/db";
import { useEffect, useState } from "react";
import type { AccountSession } from "../../lib/accountStore";
import type { TaskBoardSession } from "../taskBoardTypes";
import { readAdminAnalytics } from "./analyticsClient";

export type AdminAnalyticsSession = AccountSession & { role: "admin" };

type LoadedAnalytics = {
  requestKey: string;
  sessionKey: string;
  snapshot: ClientAnalyticsSnapshot;
};

type AnalyticsLoadError = {
  requestKey: string;
  message: string;
};

export function useAdminAnalytics(session: AdminAnalyticsSession) {
  const [rangeDays, setRangeDays] = useState<AnalyticsRangeDays>(30);
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [loaded, setLoaded] = useState<LoadedAnalytics | null>(null);
  const [loadError, setLoadError] = useState<AnalyticsLoadError | null>(null);
  const { name, passcode } = session;
  const sessionKey = `${name}\u0000${passcode ?? ""}`;
  const requestKey = `${sessionKey}\u0000${rangeDays}\u0000${refreshSequence}`;

  useEffect(() => {
    const controller = new AbortController();
    const actor: TaskBoardSession = { name, role: "admin", passcode };
    void readAdminAnalytics(actor, rangeDays, controller.signal).then(
      (snapshot) => {
        if (controller.signal.aborted) return;
        setLoaded({ requestKey, sessionKey, snapshot });
        setLoadError(null);
      },
      (errorValue: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError({
          requestKey,
          message: errorValue instanceof Error
            ? errorValue.message
            : "Analytics are unavailable."
        });
      }
    );
    return () => controller.abort();
  }, [name, passcode, rangeDays, requestKey, sessionKey]);

  // Never render one signed-in Admin's snapshot for another session.
  const snapshot = loaded?.sessionKey === sessionKey ? loaded.snapshot : null;
  const error = loadError?.requestKey === requestKey ? loadError.message : "";
  const loading = loaded?.requestKey !== requestKey
    && loadError?.requestKey !== requestKey;

  return {
    rangeDays,
    setRangeDays,
    snapshot,
    error,
    loading,
    refresh: () => setRefreshSequence((current) => current + 1)
  };
}
