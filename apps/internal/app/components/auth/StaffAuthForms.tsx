"use client";

import { LogIn } from "lucide-react";
import { FormEvent, useState } from "react";
import {
  getDemoAccounts,
  getDemoAdminCredentials,
  login,
  redeemOtp,
  saveSession,
  type AccountSession
} from "../../lib/accountStore";
import { AuthCodeInput } from "./AuthCodeInput";
import { AuthPasswordInput } from "./AuthPasswordInput";

type StaffPortalProps = {
  onAuth: (session: AccountSession) => void;
  onOpenPasscodeBoard: () => void;
};

export function StaffPortal({ onAuth, onOpenPasscodeBoard }: StaffPortalProps) {
  const [view, setView] = useState<"login" | "redeem">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const demo = getDemoAdminCredentials();
  const demoVet = getDemoAccounts().find((account) => account.role === "veterinarian")!;
  const demoStaff = getDemoAccounts().find((account) => account.role === "staff")!;

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const account = await login(email, password);
      // Pet-owner accounts are bounced to the owner door by the router.
      onAuth(saveSession(account));
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : "Login failed.";
      if (message.includes("one-time password")) {
        setError("");
        setView("redeem");
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitRedeem(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const account = await redeemOtp(email, otp, newPassword);
      onAuth(saveSession(account));
    } catch (redeemError) {
      setError(redeemError instanceof Error ? redeemError.message : "Failed to redeem one-time password.");
    } finally {
      setLoading(false);
    }
  }

  if (view === "redeem") {
    return (
      <form className="authForm" onSubmit={submitRedeem}>
        <h2 className="authFormTitle">Set your password</h2>
        <p className="authFormSubtitle">Use the one-time password provided by your administrator</p>
        <label className="authLabel">
          Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="authLabel">
          One-time password
          <AuthCodeInput value={otp} onChange={setOtp} placeholder="e.g. A1B2C3D4" />
        </label>
        <label className="authLabel">
          New password
          <AuthPasswordInput value={newPassword} onChange={setNewPassword} name="new-password" />
        </label>
        {error && <div className="authError">{error}</div>}
        <button className="authPrimaryBtn" type="submit" disabled={loading}>
          {loading ? "Activating..." : "Activate account"}
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
    <form className="authForm" onSubmit={submitLogin}>
      <h2 className="authFormTitle">Welcome back</h2>
      <p className="authFormSubtitle">Sign in to your clinic account</p>
      <div className="authDemoHint">
        <span className="authDemoLabel">Demo admin:</span>
        <code>{demo.email}</code> / <code>{demo.password}</code>
      </div>
      <div className="authDemoHint">
        <span className="authDemoLabel">Demo vet:</span>
        <code>{demoVet.email}</code> / <code>{demoVet.password}</code>
      </div>
      <div className="authDemoHint">
        <span className="authDemoLabel">Demo staff:</span>
        <code>{demoStaff.email}</code> / <code>{demoStaff.password}</code>
      </div>
      <label className="authLabel">
        Email
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="doctor@centralvet.com"
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
        First time?{" "}
        <button type="button" onClick={() => { setView("redeem"); setError(""); }}>
          Redeem your one-time password
        </button>
      </p>
      <div className="authDivider" />
      <button type="button" className="authGhostBtn" onClick={onOpenPasscodeBoard}>
        Use a clinic passcode instead
      </button>
    </form>
  );
}
