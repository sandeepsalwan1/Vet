import { readJson } from "../lib/apiClient";

export type RequestType = "prescription" | "labs_xrays" | "records_request" | "scheduling";

export type RequestFormState = {
  requestType: RequestType;
  clientName: string;
  clientPhone: string;
  clientDateOfBirth: string;
  petName: string;
  petWeight: string;
  request: string;
};

export async function submitClientRequest(form: RequestFormState) {
  return readJson(
    await fetch("/api/requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form)
    }),
    "Submission failed."
  );
}
