"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArrivalDeskSnapshot,
  ArrivalIntake,
  ArrivalQuestionnaire,
  RoomState
} from "@central-vet/db";
import {
  checkoutArrivalRoomState,
  readArrivalDeskSnapshot,
  saveArrivalDeskSettings,
  updateArrivalRoomState
} from "./arrivalDeskClient";
import type { TaskBoardSession } from "./taskBoardTypes";

export type ArrivalDeskSettingsDraft = ArrivalQuestionnaire & {
  roomAssignmentEnabled: boolean;
  visitReasonsText: string;
  sickSignsText: string;
};

type UseArrivalDeskStateArgs = {
  session: TaskBoardSession;
  actorQuery: string;
  onError(message: string): void;
};

function compactList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFromDesk(desk: ArrivalDeskSnapshot): ArrivalDeskSettingsDraft {
  const questionnaire = desk.settings.questionnaire;
  return {
    ...questionnaire,
    roomAssignmentEnabled: desk.settings.roomAssignmentEnabled,
    visitReasonsText: questionnaire.visitReasons.join(", "),
    sickSignsText: questionnaire.sickSigns.join(", ")
  };
}

function questionnaireFromDraft(draft: ArrivalDeskSettingsDraft): ArrivalQuestionnaire {
  return {
    visitReasons: compactList(draft.visitReasonsText),
    sickSignsLabel: draft.sickSignsLabel,
    sickSigns: compactList(draft.sickSignsText),
    specialConcernsLabel: draft.specialConcernsLabel,
    vaccineFeelingLabel: draft.vaccineFeelingLabel,
    surgeryAteLabel: draft.surgeryAteLabel,
    surgeryFeelingLabel: draft.surgeryFeelingLabel,
    dentalConcernLabel: draft.dentalConcernLabel,
    routineConcernLabel: draft.routineConcernLabel
  };
}

export function useArrivalDeskState({
  session,
  actorQuery,
  onError
}: UseArrivalDeskStateArgs) {
  const [desk, setDesk] = useState<ArrivalDeskSnapshot | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<ArrivalDeskSettingsDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const loadingRef = useRef(false);

  const arrivalsByRoom = useMemo(() => {
    const map = new Map<string, ArrivalIntake>();
    desk?.arrivals.forEach((arrival) => {
      if (arrival.roomId) map.set(arrival.roomId, arrival);
    });
    return map;
  }, [desk]);

  const load = useCallback(async () => {
    if (!actorQuery || loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const snapshot = await readArrivalDeskSnapshot(session, actorQuery);
      setDesk(snapshot);
      setSettingsDraft(draftFromDesk(snapshot));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Arrivals failed.");
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [actorQuery, onError, session]);

  useEffect(() => {
    let cancelled = false;
    const loadIfMounted = () => {
      if (!cancelled) void load();
    };
    const initialId = window.setTimeout(loadIfMounted, 0);
    const id = window.setInterval(loadIfMounted, 20000);
    return () => {
      cancelled = true;
      window.clearTimeout(initialId);
      window.clearInterval(id);
    };
  }, [load]);

  const updateRoomState = useCallback(async (roomId: string, state: RoomState) => {
    setSaving(true);
    try {
      await updateArrivalRoomState(session, roomId, state);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Room update failed.");
    } finally {
      setSaving(false);
    }
  }, [load, onError, session]);

  const checkout = useCallback(async (arrivalId: string) => {
    setSaving(true);
    try {
      await checkoutArrivalRoomState(session, arrivalId);
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Checkout update failed.");
    } finally {
      setSaving(false);
    }
  }, [load, onError, session]);

  const saveSettings = useCallback(async () => {
    if (!settingsDraft) return;
    setSaving(true);
    try {
      await saveArrivalDeskSettings(
        session,
        settingsDraft.roomAssignmentEnabled,
        questionnaireFromDraft(settingsDraft)
      );
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Settings save failed.");
    } finally {
      setSaving(false);
    }
  }, [load, onError, session, settingsDraft]);

  const updateSettingsDraft = useCallback((patch: Partial<ArrivalDeskSettingsDraft>) => {
    setSettingsDraft((current) => current ? { ...current, ...patch } : current);
  }, []);

  return {
    desk,
    settingsDraft,
    loading,
    saving,
    arrivalsByRoom,
    load,
    updateRoomState,
    checkout,
    saveSettings,
    updateSettingsDraft
  };
}
