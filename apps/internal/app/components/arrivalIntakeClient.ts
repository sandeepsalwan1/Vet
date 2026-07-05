import type {
  ArrivalIntake as ArrivalRecord,
  ArrivalMatch,
  ArrivalSettings
} from "@central-vet/db";
import { readJson } from "../lib/apiClient";
import {
  arrivalAnswerPayload,
  resolvePublicArrivalSettings,
  type ArrivalAnswerState
} from "./arrivalIntakeAnswers";

export type ArrivalIdentityState = {
  clientName: string;
  lastName: string;
  clientPhone: string;
  petName: string;
  loggedIn: boolean;
};

type MatchResponse =
  | { matched: true; match: ArrivalMatch }
  | { matched: false; message: string; exception?: ArrivalRecord };

type SubmitResponse =
  | { matched: true; arrival: ArrivalRecord; message: string }
  | { matched: false; message: string; exception?: ArrivalRecord };

export async function readPublicArrivalSettings(): Promise<ArrivalSettings> {
  const data = await fetch("/api/arrival-intake", { cache: "no-store" })
    .then((response) => response.json())
    .catch(() => ({}));
  return resolvePublicArrivalSettings(data);
}

export async function matchPublicArrivalIdentity(identity: ArrivalIdentityState) {
  return readJson<MatchResponse>(
    await fetch("/api/arrival-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "match",
        identity
      })
    }),
    "Check-in failed."
  );
}

export async function submitPublicArrivalQuestions(args: {
  identity: ArrivalIdentityState;
  visitReason: string;
  answers: ArrivalAnswerState;
}) {
  return readJson<SubmitResponse>(
    await fetch("/api/arrival-intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        identity: args.identity,
        visitReason: args.visitReason,
        answers: arrivalAnswerPayload(args.visitReason, args.answers)
      })
    }),
    "Check-in failed."
  );
}
