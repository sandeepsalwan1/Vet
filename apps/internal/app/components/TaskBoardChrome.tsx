"use client";

import type { AppRole } from "@central-vet/db";
import { Check, Pencil, ShieldCheck } from "lucide-react";
import { FormEvent, useState } from "react";
import { authenticateActorSession } from "../lib/authClient";
import { useClinicBrand } from "./ClinicContext";
import { roleLabel } from "./taskBoardDisplay";
import type { TaskBoardSession as Session } from "./taskBoardTypes";

export function SessionNameTag({
  session,
  onSave
}: {
  session: Session;
  onSave: (name: string) => boolean | Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(session.name);
  const displayName = session.name.trim() || roleLabel(session.role);

  if (editing) {
    return (
      <form
        className="sessionNameEdit"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            if (await onSave(draft)) setEditing(false);
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          aria-label="Current name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          disabled={saving}
          autoFocus
          maxLength={36}
        />
        <button type="submit" title="Save name" aria-label="Save name" disabled={saving}>
          <Check size={13} />
        </button>
      </form>
    );
  }

  return (
    <span className="sessionNameTag">
      <span title={displayName}>{displayName}</span>
      <button
        type="button"
        onClick={() => {
          setDraft(session.name);
          setEditing(true);
        }}
        title="Edit name"
        aria-label="Edit name"
      >
        <Pencil size={11} />
      </button>
    </span>
  );
}

export function BootScreen() {
  const clinic = useClinicBrand();
  return (
    <main className="entryShell">
      <section className="entryPanel bootPanel">
        <p className="eyebrow">{clinic.name}</p>
        <h1>Clinic Tasks</h1>
        <div className="bootLine">Opening board</div>
        <div className="bootBar" aria-hidden="true" />
      </section>
    </main>
  );
}

export function EntryScreen({ onSave }: { onSave: (session: Session) => void }) {
  const clinic = useClinicBrand();
  const [name, setName] = useState("");
  const [role, setRole] = useState<AppRole>("staff");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (role !== "veterinarian" && !name.trim()) {
      setError("Enter your name.");
      return;
    }
    if (role !== "staff" && !passcode.trim()) {
      setError("Enter passcode.");
      return;
    }

    const nextSession = {
      name: name.trim(),
      role,
      passcode: role === "staff" ? undefined : passcode.trim(),
      profileId: null
    };

    setSubmitting(true);
    setError("");
    try {
      const actor = await authenticateActorSession(nextSession);
      onSave({
        ...nextSession,
        name: actor?.name ?? nextSession.name,
        role: actor?.role ?? nextSession.role,
        profileId: actor?.profileId ?? nextSession.profileId
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Wrong passcode.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="entryShell">
      <form className="entryPanel" onSubmit={submit}>
        <p className="eyebrow">{clinic.name}</p>
        <h1>Clinic Tasks</h1>
        <label>
          {role === "veterinarian" ? "Name (optional)" : "Name"}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoFocus
            placeholder={role === "veterinarian" ? "Auto-fills from passcode" : "Your name"}
          />
        </label>
        <div className="rolePicker">
          {[
            ["staff", "Staff"],
            ["va", "VA"],
            ["veterinarian", "Veterinarian"],
            ["admin", "Admin"]
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={role === value ? "selected" : ""}
              onClick={() => setRole(value as AppRole)}
            >
              {label}
            </button>
          ))}
        </div>
        {role !== "staff" ? (
          <label>
            Passcode
            <input
              value={passcode}
              onChange={(event) => setPasscode(event.target.value.trim())}
              type="password"
              inputMode="numeric"
              placeholder="Passcode"
            />
          </label>
        ) : null}
        {role !== "staff" ? (
          <div className="authDemoHint">
            <span className="authDemoLabel">Demo passcodes:</span>
            <code>Admin/VA 246810</code> <code>Vet 135790</code>
          </div>
        ) : null}
        {error ? <div className="alertLine">{error}</div> : null}
        <button className="primaryButton" type="submit" disabled={submitting}>
          <ShieldCheck size={18} />
          {submitting ? "Checking" : "Enter"}
        </button>
      </form>
    </main>
  );
}

export function MiniConfetti() {
  return (
    <div className="miniConfetti" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}
