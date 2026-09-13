"use client";

import { KeyRound, LogIn } from "lucide-react";
import { type SubmitEvent, useState } from "react";
import {
  getDemoAccounts,
  login,
  requestPasswordReset,
  resetPasswordWithOtp,
  saveSession,
  type AccountSession
} from "../../lib/accountStore";
import { AuthCodeInput } from "./AuthCodeInput";
import { AuthPasswordInput } from "./AuthPasswordInput";

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

  async function submit(event: SubmitEvent<HTMLFormElement>) {
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

  async function submitReset(event: SubmitEvent<HTMLFormElement>) {
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
            autoComplete="username"
            name="email"
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
          autoComplete="username"
          name="email"
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
