import { getSql } from "./connection";
import { resolveClinicId } from "./clinics";
import type { Actor } from "./types";

export type RecipientProfile = {
  profileId: string;
  displayName: string;
  email: string;
  phone: string;
  passcode: string;
  active: boolean;
  emailOptIn: boolean;
  smsOptIn: boolean;
  escalationOptIn: boolean;
  dailyPriorityOptIn: boolean;
};

const defaultProfiles: RecipientProfile[] = [
  {
    profileId: "shiv",
    displayName: "Dr. Shiv",
    email: "",
    phone: "",
    passcode: "",
    active: true,
    emailOptIn: false,
    smsOptIn: false,
    escalationOptIn: false,
    dailyPriorityOptIn: false
  },
  {
    profileId: "raj",
    displayName: "Dr. Raj",
    email: "",
    phone: "",
    passcode: "",
    active: true,
    emailOptIn: false,
    smsOptIn: false,
    escalationOptIn: false,
    dailyPriorityOptIn: false
  }
];

const profileKeyPrefix = "recipient_profile:";
// Preserve the stored key while the code interface names the actual feature.
const endOfDayAlertsKey = "priority_alerts_enabled";

type SettingRow = {
  key: string;
  value: string;
};

function scopedKey(clinicId: string, key: string) {
  return `clinic:${clinicId}:${key}`;
}

function scopedProfileKeyPrefix(clinicId: string) {
  return scopedKey(clinicId, profileKeyPrefix);
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function boolOrDefault(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeProfile(value: unknown, fallback: RecipientProfile): RecipientProfile {
  const input = value && typeof value === "object"
    ? value as Partial<RecipientProfile>
    : {};
  return {
    profileId: fallback.profileId,
    displayName: cleanText(input.displayName) || fallback.displayName,
    email: cleanText(input.email) || fallback.email,
    phone: cleanText(input.phone) || fallback.phone,
    passcode: cleanText(input.passcode) || fallback.passcode,
    active: boolOrDefault(input.active, fallback.active),
    emailOptIn: boolOrDefault(input.emailOptIn, fallback.emailOptIn),
    smsOptIn: boolOrDefault(input.smsOptIn, fallback.smsOptIn),
    escalationOptIn: boolOrDefault(input.escalationOptIn, fallback.escalationOptIn),
    dailyPriorityOptIn: boolOrDefault(input.dailyPriorityOptIn, fallback.dailyPriorityOptIn)
  };
}

function fallbackProfile(profileId: string, value: unknown): RecipientProfile {
  const input = value && typeof value === "object"
    ? value as Partial<RecipientProfile>
    : {};
  return {
    profileId,
    displayName: cleanText(input.displayName) || "Veterinarian",
    email: "",
    phone: "",
    passcode: "",
    active: true,
    emailOptIn: false,
    smsOptIn: false,
    escalationOptIn: false,
    dailyPriorityOptIn: false
  };
}

function profileKey(profileId: string) {
  return `${profileKeyPrefix}${profileId}`;
}

function profileSettingsById(rows: SettingRow[], keyPrefix: string) {
  const byId = new Map<string, unknown>();
  for (const row of rows) {
    const profileId = row.key.replace(keyPrefix, "");
    try {
      byId.set(profileId, JSON.parse(row.value));
    } catch {
      byId.set(profileId, null);
    }
  }
  return byId;
}

export async function isEndOfDayAlertsEnabled(options?: { clinicId?: string | null }) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<{ value: string }[]>`
    select value
    from app_settings
    where key = ${scopedKey(clinicId, endOfDayAlertsKey)}
    limit 1
  `;
  if (rows[0]) return rows[0].value === "true";
  const fallback = await sql<{ value: string }[]>`
    select value
    from app_settings
    where key = ${endOfDayAlertsKey}
    limit 1
  `;
  return fallback[0]?.value === "true";
}

export async function listRecipientProfiles(options?: {
  clinicId?: string | null;
  includeInactive?: boolean;
}) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const scopedPrefix = scopedProfileKeyPrefix(clinicId);
  const [legacyRows, scopedRows] = await Promise.all([
    sql<SettingRow[]>`
      select key, value
      from app_settings
      where key like ${`${profileKeyPrefix}%`}
    `,
    sql<SettingRow[]>`
      select key, value
      from app_settings
      where key like ${`${scopedPrefix}%`}
    `
  ]);
  const byId = profileSettingsById(legacyRows, profileKeyPrefix);
  for (const [profileId, value] of profileSettingsById(scopedRows, scopedPrefix)) {
    byId.set(profileId, value);
  }
  const profiles = defaultProfiles.map((profile) =>
    normalizeProfile(byId.get(profile.profileId), profile)
  );
  const defaultIds = new Set(defaultProfiles.map((profile) => profile.profileId));
  for (const [profileId, value] of byId.entries()) {
    if (defaultIds.has(profileId)) continue;
    profiles.push(normalizeProfile(value, fallbackProfile(profileId, value)));
  }
  return profiles
    .filter((profile) => options?.includeInactive !== false || profile.active)
    .sort((left, right) => {
      const leftDefault = defaultProfiles.findIndex((profile) => profile.profileId === left.profileId);
      const rightDefault = defaultProfiles.findIndex((profile) => profile.profileId === right.profileId);
      if (leftDefault !== -1 || rightDefault !== -1) {
        return (leftDefault === -1 ? 99 : leftDefault) - (rightDefault === -1 ? 99 : rightDefault);
      }
      return left.displayName.localeCompare(right.displayName);
    });
}

export async function getRecipientProfile(profileId: string, options?: { clinicId?: string | null }) {
  const profiles = await listRecipientProfiles({ clinicId: options?.clinicId });
  return profiles.find((profile) => profile.profileId === profileId) ?? null;
}

export async function getRecipientProfileByPasscode(
  passcode: string | undefined,
  options?: { clinicId?: string | null }
) {
  const clean = cleanText(passcode);
  if (!clean) return null;
  const profiles = await listRecipientProfiles({
    clinicId: options?.clinicId,
    includeInactive: false
  });
  return profiles.find((profile) => profile.passcode === clean) ?? null;
}

export async function setRecipientProfile(
  profile: RecipientProfile,
  actor: Actor,
  options?: { clinicId?: string | null }
) {
  const clinicId = await resolveClinicId(options?.clinicId);
  const existing =
    (await getRecipientProfile(profile.profileId, { clinicId })) ??
    fallbackProfile(profile.profileId, profile);

  const normalized = normalizeProfile(profile, existing);
  const sql = getSql();
  const value = JSON.stringify(normalized);
  await sql`
    insert into app_settings (key, value, updated_by_name, updated_at)
    values (${scopedKey(clinicId, profileKey(normalized.profileId))}, ${value}, ${actor.name}, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_by_name = excluded.updated_by_name,
          updated_at = now()
  `;
  return normalized;
}

export async function deactivateRecipientProfile(
  profileId: string,
  actor: Actor,
  options?: { clinicId?: string | null }
) {
  const clinicId = await resolveClinicId(options?.clinicId);
  const profile = await getRecipientProfile(profileId, { clinicId });
  if (!profile) throw new Error("Unknown recipient profile.");
  return setRecipientProfile({
    ...profile,
    active: false,
    emailOptIn: false,
    smsOptIn: false,
    escalationOptIn: false,
    dailyPriorityOptIn: false
  }, actor, { clinicId });
}

export async function setEndOfDayAlertsEnabled(
  enabled: boolean,
  actor: Actor,
  options?: { clinicId?: string | null }
) {
  const sql = getSql();
  const clinicId = await resolveClinicId(options?.clinicId);
  const rows = await sql<{ value: string }[]>`
    insert into app_settings (key, value, updated_by_name, updated_at)
    values (${scopedKey(clinicId, endOfDayAlertsKey)}, ${enabled ? "true" : "false"}, ${actor.name}, now())
    on conflict (key) do update
      set value = excluded.value,
          updated_by_name = excluded.updated_by_name,
          updated_at = now()
    returning value
  `;
  return rows[0]?.value === "true";
}
