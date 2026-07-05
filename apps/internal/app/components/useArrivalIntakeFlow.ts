"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  ArrivalIntake as ArrivalRecord,
  ArrivalMatch,
  ArrivalSettings
} from "@central-vet/db";
import { getSession } from "../lib/accountStore";
import { formatPhoneInput, phoneDigits } from "../lib/phoneText";
import {
  matchPublicArrivalIdentity,
  readPublicArrivalSettings,
  submitPublicArrivalQuestions,
  type ArrivalIdentityState
} from "./arrivalIntakeClient";
import {
  blankArrivalAnswers,
  fallbackArrivalQuestionnaire,
  inferArrivalVisitReason,
  type ArrivalAnswerState
} from "./arrivalIntakeAnswers";

export type ArrivalStep = "identity" | "questions" | "done" | "exception";

const blankIdentity: ArrivalIdentityState = {
  clientName: "",
  lastName: "",
  clientPhone: "",
  petName: "",
  loggedIn: false
};

function lastName(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).at(-1) ?? "";
}

export function useArrivalIntakeFlow() {
  const [step, setStep] = useState<ArrivalStep>("identity");
  const [settings, setSettings] = useState<ArrivalSettings>({
    roomAssignmentEnabled: true,
    questionnaire: fallbackArrivalQuestionnaire
  });
  const [identity, setIdentity] = useState<ArrivalIdentityState>(blankIdentity);
  const [match, setMatch] = useState<ArrivalMatch | null>(null);
  const [visitReason, setVisitReason] = useState(fallbackArrivalQuestionnaire.visitReasons[0]);
  const [answers, setAnswers] = useState<ArrivalAnswerState>(blankArrivalAnswers);
  const [arrival, setArrival] = useState<ArrivalRecord | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const questionnaire = settings.questionnaire;

  useEffect(() => {
    let cancelled = false;
    readPublicArrivalSettings()
      .then((resolved) => {
        if (!cancelled) {
          setSettings(resolved);
          setVisitReason(resolved.questionnaire.visitReasons[0] ?? "Sick");
        }
      })
      .catch(() => undefined);

    const session = getSession();
    const autofillTimer = session?.role === "customer"
      ? window.setTimeout(() => {
          if (!cancelled) {
            setIdentity({
              clientName: session.name,
              lastName: lastName(session.name),
              clientPhone: session.phone ?? "",
              petName: session.petName ?? "",
              loggedIn: true
            });
          }
        }, 0)
      : null;
    return () => {
      cancelled = true;
      if (autofillTimer !== null) window.clearTimeout(autofillTimer);
    };
  }, []);

  const identityComplete = useMemo(() => {
    return Boolean(
      identity.lastName.trim().length >= 2 &&
      phoneDigits(identity.clientPhone).length >= 10 &&
      identity.petName.trim().length >= 2
    );
  }, [identity]);

  function updateIdentity(key: keyof ArrivalIdentityState, value: string | boolean) {
    const nextValue = key === "clientPhone" && typeof value === "string"
      ? formatPhoneInput(value)
      : value;
    setIdentity((current) => ({ ...current, [key]: nextValue }));
    setError("");
  }

  function updateAnswer(key: keyof ArrivalAnswerState, value: string) {
    setAnswers((current) => ({ ...current, [key]: value }));
    setError("");
  }

  function toggleSign(sign: string) {
    setAnswers((current) => ({
      ...current,
      sickSigns: current.sickSigns.includes(sign)
        ? current.sickSigns.filter((item) => item !== sign)
        : [...current.sickSigns, sign]
    }));
  }

  async function submitIdentity() {
    if (loading || !identityComplete) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const data = await matchPublicArrivalIdentity(identity);
      if (!data.matched) {
        setMessage(data.message);
        setStep("exception");
        return;
      }
      setMatch(data.match);
      setVisitReason(inferArrivalVisitReason(data.match.appointmentType, questionnaire.visitReasons));
      setStep("questions");
    } catch (matchError) {
      setError(matchError instanceof Error ? matchError.message : "Match failed.");
    } finally {
      setLoading(false);
    }
  }

  async function submitQuestions() {
    if (loading || !match) return;
    setLoading(true);
    setError("");
    try {
      const data = await submitPublicArrivalQuestions({ identity, visitReason, answers });
      if (!data.matched) {
        setMessage(data.message);
        setStep("exception");
        return;
      }
      setArrival(data.arrival);
      setMessage(data.message);
      setStep("done");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Check-in failed.");
    } finally {
      setLoading(false);
    }
  }

  return {
    step,
    identity,
    identityComplete,
    match,
    visitReason,
    setVisitReason,
    answers,
    arrival,
    message,
    error,
    loading,
    questionnaire,
    updateIdentity,
    updateAnswer,
    toggleSign,
    submitIdentity,
    submitQuestions
  };
}
