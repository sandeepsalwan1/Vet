import { readJson } from "./apiClient";

export type VerifiedClaimProfile = {
  clientId: string;
  clientName: string;
  email: string | null;
  phone: string;
  petId: string;
  petName: string;
  species: string;
  breed: string | null;
};

export async function requestClientAccountClaim(input: {
  contactKind: "email" | "phone";
  contactValue: string;
  petName: string;
}) {
  return readJson<{
    claimId: string;
    message: string;
    destinationHint: string | null;
    demoCode?: string;
  }>(await fetch("/api/client-account-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "request", ...input })
  }));
}

export async function verifyClientAccountClaim(claimId: string, code: string) {
  return readJson<{
    accessToken: string;
    profile: VerifiedClaimProfile;
    message: string;
  }>(await fetch("/api/client-account-claim", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "verify", claimId, code })
  }));
}
