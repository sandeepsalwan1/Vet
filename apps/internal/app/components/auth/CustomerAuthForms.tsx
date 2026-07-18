"use client";

import { KeyRound, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { FormEvent, useState } from "react";
import {
  getDemoAccounts,
  login,
  requestPasswordReset,
  resetPasswordWithOtp,
  saveSession,
  signupCustomer,
  type AccountSession
} from "../../lib/accountStore";
import { AuthCodeInput } from "./AuthCodeInput";
import { AuthPasswordInput } from "./AuthPasswordInput";
import {
  requestClientAccountClaim,
  verifyClientAccountClaim,
  type VerifiedClaimProfile
} from "../../lib/clientAccountClaimClient";

type CustomerAuthProps = {
  onAuth: (session: AccountSession) => void;
  onSwitch: () => void;
};

export function CustomerLogin({ onAuth, onSwitch }: CustomerAuthProps) {
  const [view, setView] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [issuedOtp, setIssuedOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const demoCustomer = getDemoAccounts().find((account) => account.role === "customer")!;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const account = await login(email, password);
      onAuth(saveSession(account));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  async function startReset() {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const reset = await requestPasswordReset(email);
      setIssuedOtp(reset.otp);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Password reset failed.");
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const account = await resetPasswordWithOtp(email, otp, newPassword);
      onAuth(saveSession(account));
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "Password reset failed.");
    } finally {
      setLoading(false);
    }
  }

  if (view === "forgot") {
    return (
      <form className="authForm" onSubmit={submitReset}>
        <h2 className="authFormTitle">Reset password</h2>
        <p className="authFormSubtitle">Use the code sent to your email or phone</p>
        <label className="authLabel">
          Email
          <input
            type="email"
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              setIssuedOtp("");
            }}
            placeholder="you@example.com"
            autoFocus
            required
          />
        </label>
        <button className="authGhostBtn" type="button" onClick={startReset} disabled={loading || !email.trim()}>
          <KeyRound size={16} />
          {loading ? "Sending..." : "Send code"}
        </button>
        {issuedOtp ? (
          <div className="authDemoHint">
            <span className="authDemoLabel">Mock code:</span>
            <code>{issuedOtp}</code>
          </div>
        ) : null}
        <label className="authLabel">
          Code
          <AuthCodeInput value={otp} onChange={setOtp} />
        </label>
        <label className="authLabel">
          New password
          <AuthPasswordInput value={newPassword} onChange={setNewPassword} name="new-password" />
        </label>
        {error && <div className="authError">{error}</div>}
        <button className="authPrimaryBtn" type="submit" disabled={loading || !issuedOtp}>
          {loading ? "Resetting..." : "Reset and sign in"}
        </button>
        <p className="authSwitch">
          <button type="button" onClick={() => { setView("login"); setError(""); }}>
            Back to sign in
          </button>
        </p>
      </form>
    );
  }

  return (
    <form className="authForm" onSubmit={submit}>
      <h2 className="authFormTitle">Welcome back</h2>
      <p className="authFormSubtitle">Sign in to manage your pet&apos;s care</p>
      <div className="authDemoHint">
        <span className="authDemoLabel">Demo owner:</span>
        <code>{demoCustomer.email}</code> / <code>{demoCustomer.password}</code>
      </div>
      <label className="authLabel">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoFocus
          required
        />
      </label>
      <label className="authLabel">
        Password
        <AuthPasswordInput value={password} onChange={setPassword} />
      </label>
      {error && <div className="authError">{error}</div>}
      <button className="authPrimaryBtn" type="submit" disabled={loading}>
        <LogIn size={16} />
        {loading ? "Signing in..." : "Sign in"}
      </button>
      <p className="authSwitch">
        <button type="button" onClick={() => { setView("forgot"); setError(""); }}>
          Forgot password?
        </button>
      </p>
      <p className="authSwitch">
        Don&apos;t have an account?{" "}
        <button type="button" onClick={onSwitch}>
          Create one
        </button>
      </p>
    </form>
  );
}

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

  async function requestMatch(event: FormEvent) {
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

  async function verifyMatch(event: FormEvent) {
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

  async function finishAccount(event: FormEvent) {
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
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
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
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoFocus required />
        </label>
      ) : (
        <label className="authLabel">
          Phone on clinic record <span className="authRequired">*</span>
          <input type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(555) 000-0000" inputMode="tel" autoFocus required />
        </label>
      )}
      <label className="authLabel">
        Pet&apos;s name <span className="authRequired">*</span>
        <input
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
