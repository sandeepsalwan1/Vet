"use client";

import type { RecipientProfile } from "@central-vet/db";
import { Settings, UserPlus, UserX } from "lucide-react";
import { useState } from "react";
import { smsPhoneReady } from "../lib/phoneText";

const blankVeterinarianProfile: RecipientProfile = {
  profileId: "",
  displayName: "Dr. ",
  email: "",
  phone: "",
  passcode: "",
  active: true,
  emailOptIn: false,
  smsOptIn: false,
  escalationOptIn: false,
  dailyPriorityOptIn: false
};

type NotificationSettingsMenuProps = {
  open: boolean;
  saving: boolean;
  endOfDayAlertsEnabled: boolean;
  recipientProfiles: RecipientProfile[];
  canEditAllProfiles: boolean;
  currentProfileId: string | null;
  addingProfile: boolean;
  onToggleOpen: () => void;
  onToggleEndOfDayAlerts: () => void;
  onSaveProfile: (profile: RecipientProfile) => void;
  onDeactivateProfile: (profile: RecipientProfile) => void;
  onAddProfile: () => void;
};

export function NotificationSettingsMenu({
  open,
  saving,
  endOfDayAlertsEnabled,
  recipientProfiles,
  canEditAllProfiles,
  currentProfileId,
  addingProfile,
  onToggleOpen,
  onToggleEndOfDayAlerts,
  onSaveProfile,
  onDeactivateProfile,
  onAddProfile
}: NotificationSettingsMenuProps) {
  const activeProfiles = recipientProfiles.filter((profile) => profile.active);

  return (
    <div className="settingsMenu">
      <button
        type="button"
        className="plainButton compact"
        onClick={onToggleOpen}
      >
        <Settings size={16} />
        Settings
      </button>
      {open ? (
        <div className="settingsPanel">
          {canEditAllProfiles ? (
            <label className="toggleLine strongToggle">
              <input
                type="checkbox"
                checked={endOfDayAlertsEnabled}
                disabled={saving}
                onChange={() => void onToggleEndOfDayAlerts()}
              />
              End-of-day alert
            </label>
          ) : null}
          <p className="settingsHelp">
            Sends once daily when any medium or high priority task is still open or overdue.
          </p>
          <div className="settingsDivider" />
          <div className="settingsTitle">
            <strong>Veterinarian notifications</strong>
            <span>
              Choose delivery channels and alert types separately. Escalated tasks appear for veterinarians and Admin.
            </span>
          </div>
          {activeProfiles.map((profile) => (
            <ProfileSettings
              key={`${profile.profileId}:${profile.displayName}:${profile.email}:${profile.phone}:${profile.passcode}:${profile.active}:${profile.emailOptIn}:${profile.smsOptIn}:${profile.escalationOptIn}:${profile.dailyPriorityOptIn}`}
              profile={profile}
              saving={saving}
              canEditAll={canEditAllProfiles}
              currentProfileId={currentProfileId}
              onChange={onSaveProfile}
              onDeactivate={onDeactivateProfile}
            />
          ))}
          {addingProfile ? (
            <ProfileSettings
              profile={blankVeterinarianProfile}
              saving={saving}
              canEditAll={canEditAllProfiles}
              currentProfileId={currentProfileId}
              onChange={onSaveProfile}
              onDeactivate={onDeactivateProfile}
              isNew
            />
          ) : null}
          {canEditAllProfiles ? (
            <button
              type="button"
              className="plainButton compact"
              disabled={saving}
              onClick={onAddProfile}
            >
              <UserPlus size={16} />
              Add veterinarian
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

type ProfileSettingsProps = {
  profile: RecipientProfile;
  saving: boolean;
  canEditAll: boolean;
  currentProfileId: string | null;
  onChange: (profile: RecipientProfile) => void;
  onDeactivate: (profile: RecipientProfile) => void;
  isNew?: boolean;
};

function ProfileSettings({
  profile,
  saving,
  canEditAll,
  currentProfileId,
  onChange,
  onDeactivate,
  isNew = false
}: ProfileSettingsProps) {
  const [draft, setDraft] = useState(profile);
  const ownProfile = draft.profileId === currentProfileId;
  const canEdit = canEditAll || ownProfile || isNew;
  const update = (patch: Partial<RecipientProfile>) => {
    setDraft({ ...draft, ...patch });
  };
  const channelCount = Number(draft.emailOptIn) + Number(draft.smsOptIn);
  const alertCount = Number(draft.escalationOptIn) + Number(draft.dailyPriorityOptIn);
  const smsReady = smsPhoneReady(draft.phone);

  return (
    <section className={`profileSettings ${!draft.active ? "inactiveProfile" : ""}`}>
      <div className="profileHeader">
        <div>
          <strong>{draft.displayName || "New veterinarian"}</strong>
          <small>
            {draft.active ? "Active" : "Inactive"} · {channelCount}/2 channels · {alertCount}/2 alert types
          </small>
        </div>
        <span>{draft.escalationOptIn ? "Escalation on" : "Escalation off"}</span>
      </div>
      <div className="settingsGrid">
        <label>
          Profile name
          <input
            value={draft.displayName}
            disabled={saving || !canEdit}
            onChange={(event) => update({ displayName: event.target.value })}
            placeholder="Dr. Name"
          />
        </label>
        {canEditAll || isNew ? (
          <label>
            Login passcode
            <input
              value={draft.passcode}
              disabled={saving || !canEdit}
              onChange={(event) => update({ passcode: event.target.value })}
              placeholder="4+ digits"
              inputMode="numeric"
            />
          </label>
        ) : null}
        <label>
          Email
          <input
            value={draft.email}
            disabled={saving || !canEdit}
            onChange={(event) => update({ email: event.target.value })}
            placeholder="email address"
          />
        </label>
        <label>
          Phone
          <input
            value={draft.phone}
            disabled={saving || !canEdit}
            onChange={(event) => update({ phone: event.target.value })}
            placeholder="10-digit number"
            inputMode="tel"
          />
          {draft.smsOptIn && !smsReady ? (
            <span className="fieldHint">SMS needs a 10-digit number.</span>
          ) : null}
        </label>
      </div>
      <div className="profileSubhead">Delivery channels</div>
      <div className="profileToggles">
        <label className="toggleLine">
          <input
            type="checkbox"
            checked={draft.emailOptIn}
            disabled={saving || !canEdit}
            onChange={(event) => update({ emailOptIn: event.target.checked })}
          />
          Email opt-in
        </label>
        <label className="toggleLine">
          <input
            type="checkbox"
            checked={draft.smsOptIn}
            disabled={saving || !canEdit}
            onChange={(event) => update({ smsOptIn: event.target.checked })}
          />
          SMS opt-in
        </label>
      </div>
      <div className="profileSubhead">Alert types</div>
      <div className="profileToggles">
        <label className="toggleLine">
          <input
            type="checkbox"
            checked={draft.escalationOptIn}
            disabled={saving || !canEdit}
            onChange={(event) => update({ escalationOptIn: event.target.checked })}
          />
          Escalation alerts
        </label>
        <label className="toggleLine">
          <input
            type="checkbox"
            checked={draft.dailyPriorityOptIn}
            disabled={saving || !canEdit}
            onChange={(event) => update({ dailyPriorityOptIn: event.target.checked })}
          />
          Daily medium/high alerts
        </label>
      </div>
      <div className="profileActions">
        <button
          type="button"
          className="plainButton compact"
          disabled={saving || !canEdit || !draft.displayName.trim() || !draft.passcode.trim()}
          onClick={() => void onChange(draft)}
        >
          Save settings
        </button>
        {canEditAll && !isNew && draft.active ? (
          <button
            type="button"
            className="plainButton compact dangerText"
            disabled={saving}
            onClick={() => void onDeactivate(draft)}
          >
            <UserX size={16} />
            Deactivate
          </button>
        ) : null}
      </div>
    </section>
  );
}
