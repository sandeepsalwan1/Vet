import type { Actor, AppRole } from "@central-vet/db";
import type { AccountSession } from "./accountStore";
import { readJson } from "./apiClient";

export type AuthSessionValidation = "valid" | "invalid" | "unknown";

type ActorCredentials = {
  name: string;
  role: AppRole;
  passcode?: string | null;
  profileId?: string | null;
};

function authRequest(actor: ActorCredentials) {
  return fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actor })
  });
}

export async function authenticateActorSession(actor: ActorCredentials) {
  const data = await readJson<{ actor?: Actor }>(await authRequest(actor));
  return data.actor;
}

async function validateActorSession(actor: ActorCredentials): Promise<AuthSessionValidation> {
  try {
    const response = await authRequest(actor);
    if (response.ok) return "valid";
    if (response.status === 401 || response.status === 403) return "invalid";
    return "unknown";
  } catch {
    return "unknown";
  }
}

export function validateAccountTeamSession(session: AccountSession) {
  if (session.role === "customer") return Promise.resolve<AuthSessionValidation>("valid");
  return validateActorSession({
    name: session.name,
    role: session.role,
    passcode: session.passcode
  });
}
