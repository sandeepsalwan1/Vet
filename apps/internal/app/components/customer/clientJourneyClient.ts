import type { ClientJourneySnapshot } from "@central-vet/db";
import { readJson } from "../../lib/apiClient";

function tokenHeaders(accessToken: string, json = false) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    Authorization: `Bearer ${accessToken}`
  };
}

export async function readClientJourney(accessToken: string) {
  return readJson<ClientJourneySnapshot>(await fetch("/api/client-journey", {
    cache: "no-store",
    headers: tokenHeaders(accessToken)
  }));
}

export async function updateClientJourney(accessToken: string, body: Record<string, unknown>) {
  return readJson<{ ok: true; message: string }>(await fetch("/api/client-journey", {
    method: "POST",
    headers: tokenHeaders(accessToken, true),
    body: JSON.stringify(body)
  }));
}
