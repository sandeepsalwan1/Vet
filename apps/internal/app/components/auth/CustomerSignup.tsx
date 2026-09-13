"use client";

import { ShieldCheck, UserPlus } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import {
  saveSession,
  signupCustomer,
  type AccountSession
} from "../../lib/accountStore";
import {
  requestClientAccountClaim,
  verifyClientAccountClaim,
  type VerifiedClaimProfile
} from "../../lib/clientAccountClaimClient";
import { AuthCodeInput } from "./AuthCodeInput";
import { AuthPasswordInput } from "./AuthPasswordInput";

type CustomerAuthProps = {
  onAuth: (session: AccountSession) => void;
  onSwitch: () => void;
};

export function CustomerSignup({ onAuth, onSwitch }: CustomerAuthProps) {
  const [step, setStep] = useState<"match" | "verify" | "password">("match");
  const [contactKind, setContactKind] = useState<"email" | "phone">("email");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [petName, setPetName] = useState("");
  const [claimId, setClaimId] = useState("");
  const [code, setCode] = useState("");
  const [demoCode, setDemoCode] = useState("");
  const [claimMessage, setClaimMessage] = useState("");
  const [verified, setVerified] = useState<{ profile: VerifiedClaimProfile; accessToken: string } | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function requestMatch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    const contactValue = contactKind === "email" ? email : phone;
    if (contactKind === "email" && !contactValue.includes("@")) {
      setError("Enter the email on your clinic record.");
      return;
    }
    if (contactKind === "phone" && contactValue.replace(/\D/g, "").length < 10) {
      setError("Enter the phone number on your clinic record.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await requestClientAccountClaim({ contactKind, contactValue, petName });
      setClaimId(result.claimId);
      setClaimMessage(result.message);
      setDemoCode(result.demoCode ?? "");
      setStep("verify");
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Account verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function verifyMatch(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await verifyClientAccountClaim(claimId, code);
      setVerified({ profile: result.profile, accessToken: result.accessToken });
      setEmail(result.profile.email ?? email);
      setPhone(result.profile.phone);
      setPetName(result.profile.petName);
      setStep("password");
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Code verification failed.");
    } finally {
      setLoading(false);
    }
  }

  async function finishAccount(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || !verified) return;
    if (!email.includes("@")) {
      setError("Enter an email to use for sign-in.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const account = await signupCustomer({
        name: verified.profile.clientName,
        email,
        phone: verified.profile.phone,
        petName: verified.profile.petName,
        password,
        clientId: verified.profile.clientId,
        petId: verified.profile.petId,
        accessToken: verified.accessToken
      });
      onAuth(saveSession(account));
    } catch (signupError) {
      setError(signupError instanceof Error ? signupError.message : "Account setup failed.");
    } finally {
      setLoading(false);
    }
  }

  if (step === "verify") {
    return (
      <form className="authForm" onSubmit={verifyMatch}>
        <h2 className="authFormTitle">Check your code</h2>
        <p className="authFormSubtitle">{claimMessage}</p>
        {demoCode ? (
          <div className="authDemoHint">
            <span className="authDemoLabel">Mock code:</span>
            <code>{demoCode}</code>
          </div>
        ) : null}
        <label className="authLabel">
          6-digit code
          <AuthCodeInput value={code} onChange={setCode} />
        </label>
        {error && <div className="authError">{error}</div>}
        <button className="authPrimaryBtn" type="submit" disabled={loading || code.length !== 6}>
          <ShieldCheck size={16} />
          {loading ? "Checking..." : "Verify clinic record"}
        </button>
        <p className="authSwitch">
          <button type="button" onClick={() => { setStep("match"); setError(""); }}>
            Change details
          </button>
        </p>
      </form>
    );
  }

  if (step === "password" && verified) {
    return (
      <form className="authForm" onSubmit={finishAccount}>
        <h2 className="authFormTitle">Clinic record verified</h2>
        <p className="authFormSubtitle">Finish secure access for {verified.profile.petName}</p>
        <div className="authDemoHint">
          <span className="authDemoLabel">Matched:</span>
          <strong>{verified.profile.clientName}</strong> and <strong>{verified.profile.petName}</strong>
        </div>
        <label className="authLabel">
          Sign-in email <span className="authRequired">*</span>
          <input
            autoComplete="email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label className="authLabel">
          Password <span className="authRequired">*</span>
          <AuthPasswordInput value={password} onChange={setPassword} name="new-password" />
        </label>
        {error && <div className="authError">{error}</div>}
        <button className="authPrimaryBtn" type="submit" disabled={loading}>
          <UserPlus size={16} />
          {loading ? "Finishing..." : "Create verified account"}
        </button>
      </form>
    );
  }

  return (
    <form className="authForm" onSubmit={requestMatch}>
      <h2 className="authFormTitle">Find your clinic record</h2>
      <p className="authFormSubtitle">New portal access starts with a safe record match</p>
      <div className="authSegmented" role="group" aria-label="Verification method">
        <button type="button" className={contactKind === "email" ? "active" : ""} onClick={() => setContactKind("email")}>Email</button>
        <button type="button" className={contactKind === "phone" ? "active" : ""} onClick={() => setContactKind("phone")}>Phone</button>
      </div>
      {contactKind === "email" ? (
        <label className="authLabel">
          Email on clinic record <span className="authRequired">*</span>
          <input
            autoComplete="email"
            name="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            autoFocus
            required
          />
        </label>
      ) : (
        <label className="authLabel">
          Phone on clinic record <span className="authRequired">*</span>
          <input
            autoComplete="tel"
            name="phone"
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="(555) 000-0000"
            inputMode="tel"
            autoFocus
            required
          />
        </label>
      )}
      <label className="authLabel">
        Pet&apos;s name <span className="authRequired">*</span>
        <input
          autoComplete="off"
          name="pet-name"
          type="text"
          value={petName}
          onChange={(event) => setPetName(event.target.value)}
          placeholder="Buddy, Luna, Max"
          required
        />
      </label>
      {error && <div className="authError">{error}</div>}
      <button className="authPrimaryBtn" type="submit" disabled={loading}>
        <ShieldCheck size={16} />
        {loading ? "Checking..." : "Send verification code"}
      </button>
      <p className="authSwitch">
        Already have an account?{" "}
        <button type="button" onClick={onSwitch}>
          Sign in
        </button>
      </p>
    </form>
  );
}
