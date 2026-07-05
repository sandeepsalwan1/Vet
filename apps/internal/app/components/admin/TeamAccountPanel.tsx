"use client";

import {
  Clipboard,
  ClipboardCheck,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Stethoscope,
  UserPlus,
  Users,
} from "lucide-react";
import { FormEvent, useState } from "react";
import {
  createTeamMember,
  listTeam,
  logout,
  type Account,
  type AccountSession,
  type TeamRole,
} from "../../lib/accountStore";
import { useClinicBrand } from "../ClinicContext";

type Props = {
  session: AccountSession;
  onLogout: () => void;
  onOpenTaskBoard: () => void;
  // When embedded inside the admin dashboard tab, skip the standalone header/shell.
  embedded?: boolean;
};

function CopyableOtp({ otp }: { otp: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(otp);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="otpDisplay">
      <code className="otpCode">{otp}</code>
      <button type="button" className="otpCopyBtn" onClick={copy} title="Copy one-time password">
        {copied ? <ClipboardCheck size={16} /> : <Clipboard size={16} />}
        {copied ? "Copied!" : "Copy"}
      </button>
    </div>
  );
}

export function TeamAccountPanel({ session, onLogout, onOpenTaskBoard, embedded = false }: Props) {
  const clinic = useClinicBrand();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("veterinarian");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createdOtp, setCreatedOtp] = useState<{ name: string; otp: string } | null>(null);
  const [team, setTeam] = useState<Account[]>(() => listTeam());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    setCreatedOtp(null);
    try {
      const { account, otp } = await createTeamMember({ name, email, role });
      setCreatedOtp({ name: account.name, otp });
      setTeam(listTeam());
      setName("");
      setEmail("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account.");
    } finally {
      setLoading(false);
    }
  }

  function handleLogout() {
    logout();
    onLogout();
  }

  return (
    <div className={embedded ? "adminShell adminShell--embedded" : "adminShell"}>
      {!embedded && (
        <header className="adminHeader">
          <div className="adminHeaderLeft">
            <ShieldCheck size={22} strokeWidth={1.8} />
            <div>
              <p className="adminHeaderEyebrow">{clinic.name}</p>
              <h1 className="adminHeaderTitle">Admin Portal</h1>
            </div>
          </div>
          <div className="adminHeaderRight">
            <span className="adminHeaderUser">{session.name}</span>
            <button
              className="plainButton adminBoardBtn"
              onClick={onOpenTaskBoard}
              title="Open clinic task board"
            >
              <LayoutDashboard size={16} />
              Task Board
            </button>
            <button className="iconButton" onClick={handleLogout} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </header>
      )}

      <main className="adminMain">
        <div className="adminGrid">
          <section className="adminCard">
            <div className="adminCardHeader">
              <UserPlus size={18} />
              <h2>Add team member</h2>
            </div>
            <p className="adminCardDesc">
              Create a vet or staff account. They get a one-time password to set their own login.
            </p>

            {createdOtp && (
              <div className="adminSuccessBox">
                <h3>Account created for {createdOtp.name}</h3>
                <p>Share this one-time password securely. It expires on first use.</p>
                <CopyableOtp otp={createdOtp.otp} />
                <p className="adminSuccessNote">
                  They open the <strong>Clinic Team</strong> tab on the login page and redeem this
                  password to finish setup.
                </p>
              </div>
            )}

            <form className="adminForm" onSubmit={submit}>
              <div className="adminRoleToggle" role="group" aria-label="Account type">
                <button
                  type="button"
                  className={`adminRoleBtn${role === "veterinarian" ? " adminRoleBtn--active" : ""}`}
                  onClick={() => setRole("veterinarian")}
                >
                  <Stethoscope size={15} />
                  Veterinarian
                </button>
                <button
                  type="button"
                  className={`adminRoleBtn${role === "staff" ? " adminRoleBtn--active" : ""}`}
                  onClick={() => setRole("staff")}
                >
                  <Users size={15} />
                  Staff
                </button>
              </div>
              <label className="authLabel">
                Full name
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Dr. Jane Smith"
                  required
                  autoFocus
                />
              </label>
              <label className="authLabel">
                Email
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="dr.smith@centralvet.com"
                  required
                />
              </label>
              {error && <div className="authError">{error}</div>}
              <button className="authPrimaryBtn" type="submit" disabled={loading}>
                <UserPlus size={16} />
                {loading ? "Creating…" : `Add ${role === "staff" ? "staff" : "veterinarian"}`}
              </button>
            </form>
          </section>

          <section className="adminCard">
            <div className="adminCardHeader">
              <Users size={18} />
              <h2>Clinic team</h2>
              <span className="adminVetCount">{team.length}</span>
            </div>

            {team.length === 0 ? (
              <p className="adminEmptyState">No team accounts yet. Add one above.</p>
            ) : (
              <div className="adminVetList">
                {team.map((member) => (
                  <div key={member.id} className="adminVetRow">
                    <div className="adminVetInfo">
                      <span className="adminVetName">
                        {member.name}
                        <span className="adminRoleTag">
                          {member.role === "staff" ? "Staff" : "Veterinarian"}
                        </span>
                      </span>
                      <span className="adminVetEmail">{member.email}</span>
                    </div>
                    <div className="adminVetStatus">
                      {member.mustResetPassword ? (
                        <span className="adminVetPending">Pending activation</span>
                      ) : (
                        <span className="adminVetActive">Active</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
