"use client";

import { CheckCircle2, Send } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";
import { fieldErrors as apiFieldErrors } from "../lib/apiClient";
import { formatPhoneInput } from "../lib/phoneText";
import { useClinicBrand } from "./ClinicContext";
import { submitClientRequest, type RequestFormState, type RequestType } from "./requestFormClient";

type FieldErrors = Partial<Record<keyof RequestFormState, string>>;

const blank: RequestFormState = {
  requestType: "scheduling",
  clientName: "",
  clientPhone: "",
  clientDateOfBirth: "",
  petName: "",
  petWeight: "",
  request: ""
};

const requestTypes: { value: RequestType; label: string }[] = [
  { value: "prescription", label: "Prescription" },
  { value: "labs_xrays", label: "Labs & X-Rays" },
  { value: "records_request", label: "Records Request" },
  { value: "scheduling", label: "Appointment" }
];

function requiredLabel(text: string) {
  return (
    <span className="cvRequestLabelText">
      {text} <span className="cvRequestRequiredStar">*</span>
    </span>
  );
}

export function RequestForm() {
  const clinic = useClinicBrand();
  const [form, setForm] = useState<RequestFormState>(blank);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const update = (key: keyof RequestFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: undefined }));
    setError("");
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError("");
    setFieldErrors({});
    try {
      await submitClientRequest(form);
      setDone(true);
      setForm(blank);
    } catch (submitError) {
      if (submitError instanceof Error) {
        setError(submitError.message);
        setFieldErrors(apiFieldErrors<keyof RequestFormState>(submitError));
      } else {
        setError("Submission failed.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="publicShell">
      <section className="publicPanel">
        <div className="publicHeader">
          <div>
            <p>{clinic.name}</p>
            <h1>Client Request</h1>
          </div>
        </div>

        {done ? (
          <div className="successBox cvRequestSuccessBox">
            <CheckCircle2 size={34} />
            <h2>Request received</h2>
            <p>It is on the clinic dashboard. For emergencies, call the hospital directly.</p>
            <button type="button" onClick={() => setDone(false)}>
              Submit another request
            </button>
          </div>
        ) : (
          <form className="cvRequestForm publicForm" onSubmit={submit} noValidate>
            <fieldset className="cvRequestTypePicker">
              <legend>{requiredLabel("Request Type")}</legend>
              {requestTypes.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={form.requestType === item.value ? "selected" : ""}
                  onClick={() => update("requestType", item.value)}
                >
                  {item.label}
                </button>
              ))}
              {fieldErrors.requestType ? <span className="cvRequestFieldError">{fieldErrors.requestType}</span> : null}
            </fieldset>
            <div className="cvRequestGrid publicGrid">
              <label>
                {requiredLabel("Your name")}
                <input
                  className={fieldErrors.clientName ? "cvRequestFieldInvalid" : ""}
                  required
                  value={form.clientName}
                  onChange={(event) => update("clientName", event.target.value)}
                  autoFocus
                />
                {fieldErrors.clientName ? <span className="cvRequestFieldError">{fieldErrors.clientName}</span> : null}
              </label>
              <label>
                {requiredLabel("Phone")}
                <input
                  className={fieldErrors.clientPhone ? "cvRequestFieldInvalid" : ""}
                  required
                  value={form.clientPhone}
                  onChange={(event) => update("clientPhone", formatPhoneInput(event.target.value))}
                  inputMode="tel"
                />
                {fieldErrors.clientPhone ? <span className="cvRequestFieldError">{fieldErrors.clientPhone}</span> : null}
              </label>
              <label>
                {requiredLabel("Pet's name")}
                <input
                  className={fieldErrors.petName ? "cvRequestFieldInvalid" : ""}
                  required
                  value={form.petName}
                  onChange={(event) => update("petName", event.target.value)}
                />
                {fieldErrors.petName ? <span className="cvRequestFieldError">{fieldErrors.petName}</span> : null}
              </label>
              <label>
                Pet&apos;s date of birth
                <input
                  className={fieldErrors.clientDateOfBirth ? "cvRequestFieldInvalid" : ""}
                  type="date"
                  value={form.clientDateOfBirth}
                  onChange={(event) => update("clientDateOfBirth", event.target.value)}
                />
                {fieldErrors.clientDateOfBirth ? <span className="cvRequestFieldError">{fieldErrors.clientDateOfBirth}</span> : null}
              </label>
              <label>
                Pet&apos;s weight
                <input
                  className={fieldErrors.petWeight ? "cvRequestFieldInvalid" : ""}
                  value={form.petWeight}
                  onChange={(event) => update("petWeight", event.target.value)}
                />
                {fieldErrors.petWeight ? <span className="cvRequestFieldError">{fieldErrors.petWeight}</span> : null}
              </label>
            </div>
            <label>
              {requiredLabel("Request")}
              <textarea
                className={fieldErrors.request ? "cvRequestFieldInvalid" : ""}
                required
                rows={7}
                value={form.request}
                onChange={(event) => update("request", event.target.value)}
              />
              {fieldErrors.request ? <span className="cvRequestFieldError">{fieldErrors.request}</span> : null}
            </label>
            {error ? <div className="errorBox cvRequestErrorBox">{error}</div> : null}
            <button className="sendButton cvRequestSendButton" type="submit" disabled={submitting}>
              <Send size={18} />
              {submitting ? "Sending" : "Submit Request"}
            </button>
            <p className="cvRequestRequiredNote"><span className="cvRequestRequiredStar">*</span> Required</p>
          </form>
        )}
      </section>
    </main>
  );
}
