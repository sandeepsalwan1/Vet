import type { AppRole } from "@central-vet/db";

export type BrowserActorSession = {
  name: string;
  role: AppRole;
  passcode?: string;
  profileId?: string | null;
};

export function browserActorBody(session: BrowserActorSession) {
  return {
    name: session.name,
    role: session.role,
    passcode: session.passcode,
    profileId: session.profileId
  };
}

export function browserActorReadQuery(
  session: Pick<BrowserActorSession, "name" | "role">,
  params: Record<string, string | number | boolean | undefined> = {}
) {
  const query = new URLSearchParams();
  if (session.name) query.set("name", session.name);
  query.set("role", session.role);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, String(value));
  }
  return query.toString();
}

export function browserActorReadHeaders(session: Pick<BrowserActorSession, "passcode">) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (session.passcode) headers["X-Central-Vet-Passcode"] = session.passcode;
  return headers;
}
