// MOCK ACCOUNT STORE — localStorage backend
// All functions are async to mirror the future REST interface.
// Replace implementations with real API calls when the backend is ready.
// SECURITY NOTE: mockHash is NOT cryptographic. Replace with bcrypt server-side.

import {
  ACCOUNTS_KEY,
  DEMO_ACCOUNTS,
  type Account,
  type TeamRole
} from "./accountModel";

export type { Account, AccountSession, TeamRole } from "./accountModel";
export { getSession, logout, saveSession } from "./accountSessionStore";

// MOCK: base64 + salt. Replace with real hashing server-side.
function mockHash(value: string): string {
  return btoa(encodeURIComponent(`${value}::cvh-mock-salt`));
}

function mockVerify(value: string, hash: string): boolean {
  return mockHash(value) === hash;
}

function loadAccounts(): Account[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) ?? "[]") as Account[];
  } catch {
    return [];
  }
}

function persistAccounts(accounts: Account[]): void {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function uid(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function generateOtp(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function cleanEmail(value: string): string {
  return value.toLowerCase().trim();
}

function findAccountIndexByEmail(accounts: Account[], email: string): number {
  const normalized = cleanEmail(email);
  return accounts.findIndex((account) => account.email === normalized);
}

function seedDemoAccounts(): void {
  const accounts = loadAccounts();
  const existingEmails = new Set(accounts.map((account) => account.email));
  const seeded = DEMO_ACCOUNTS
    .filter((account) => !existingEmails.has(account.email))
    .map((account) => ({
      id: uid(),
      role: account.role,
      name: account.name,
      email: account.email,
      phone: "phone" in account ? account.phone : undefined,
      petName: "petName" in account ? account.petName : undefined,
      passcode: "passcode" in account ? account.passcode : undefined,
      passwordHash: mockHash(account.password),
      createdAt: new Date().toISOString(),
    }));
  if (seeded.length) persistAccounts([...accounts, ...seeded]);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getDemoAdminCredentials() {
  return DEMO_ACCOUNTS.find((account) => account.role === "admin")!;
}

export function getDemoAccounts() {
  return DEMO_ACCOUNTS;
}

export async function signupCustomer(params: {
  name: string;
  email: string;
  phone: string;
  petName: string;
  password: string;
}): Promise<Account> {
  seedDemoAccounts();
  const accounts = loadAccounts();
  if (findAccountIndexByEmail(accounts, params.email) !== -1) {
    throw new Error("An account with this email already exists.");
  }
  const account: Account = {
    id: uid(),
    role: "customer",
    name: params.name.trim(),
    email: cleanEmail(params.email),
    phone: params.phone.trim(),
    petName: params.petName.trim(),
    passwordHash: mockHash(params.password),
    createdAt: new Date().toISOString(),
  };
  persistAccounts([...accounts, account]);
  return account;
}

export async function login(email: string, password: string): Promise<Account> {
  seedDemoAccounts();
  const accounts = loadAccounts();
  const account = accounts[findAccountIndexByEmail(accounts, email)];
  if (!account) throw new Error("No account found with this email.");
  if (account.mustResetPassword) {
    throw new Error("Please redeem your one-time password to set a new password.");
  }
  if (!mockVerify(password, account.passwordHash)) throw new Error("Incorrect password.");
  return account;
}

// Admin creates a clinic team member (veterinarian or staff). New members get a
// one-time password and must set their own password on first sign-in.
export async function createTeamMember(params: {
  name: string;
  email: string;
  role: TeamRole;
}): Promise<{ account: Account; otp: string }> {
  const accounts = loadAccounts();
  if (findAccountIndexByEmail(accounts, params.email) !== -1) {
    throw new Error("An account with this email already exists.");
  }
  const otp = generateOtp();
  const account: Account = {
    id: uid(),
    role: params.role,
    name: params.name.trim(),
    email: cleanEmail(params.email),
    passwordHash: "",
    mustResetPassword: true,
    otp,
    createdAt: new Date().toISOString(),
  };
  persistAccounts([...accounts, account]);
  return { account, otp };
}

export async function redeemOtp(
  email: string,
  otp: string,
  newPassword: string
): Promise<Account> {
  const accounts = loadAccounts();
  const idx = findAccountIndexByEmail(accounts, email);
  if (idx === -1) throw new Error("No account found with this email.");
  const account = accounts[idx];
  if (!account.mustResetPassword || account.otp !== otp.trim().toUpperCase()) {
    throw new Error("Invalid or expired one-time password.");
  }
  if (newPassword.length < 6) throw new Error("Password must be at least 6 characters.");
  const updated: Account = {
    ...account,
    passwordHash: mockHash(newPassword),
    mustResetPassword: false,
    otp: undefined,
  };
  const next = [...accounts];
  next[idx] = updated;
  persistAccounts(next);
  return updated;
}

export async function requestPasswordReset(email: string): Promise<{ email: string; otp: string }> {
  seedDemoAccounts();
  const accounts = loadAccounts();
  const idx = findAccountIndexByEmail(accounts, email);
  if (idx === -1) throw new Error("No account found with this email.");
  const otp = generateOtp();
  const updated: Account = {
    ...accounts[idx],
    mustResetPassword: true,
    otp,
  };
  const next = [...accounts];
  next[idx] = updated;
  persistAccounts(next);
  return { email: updated.email, otp };
}

export async function resetPasswordWithOtp(
  email: string,
  otp: string,
  newPassword: string
): Promise<Account> {
  return redeemOtp(email, otp, newPassword);
}

export function listTeam(): Account[] {
  return loadAccounts()
    .filter((a) => a.role === "veterinarian" || a.role === "staff")
    .sort((a, b) => a.name.localeCompare(b.name));
}
