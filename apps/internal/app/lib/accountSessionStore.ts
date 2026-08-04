import {
  DEMO_PASSCODES,
  LEGACY_SESSION_KEY,
  SESSION_KEY,
  type Account,
  type AccountSession,
  type AuthRole
} from "./accountModel";

function taskBoardPasscodeForRole(role: AuthRole, passcode: string | undefined): string | undefined {
  const current = passcode?.trim();
  if (current) return current;
  // The mock account store is browser-only; manager task routes still use the
  // server-recognized demo passcodes until real account auth replaces it.
  if (role === "admin") return DEMO_PASSCODES.admin;
  if (role === "veterinarian") return DEMO_PASSCODES.veterinarian;
  return undefined;
}

function sessionForAccount(account: Account): AccountSession {
  return {
    accountId: account.id,
    role: account.role,
    name: account.name,
    email: account.email,
    phone: account.phone,
    petName: account.petName,
    clientId: account.clientId,
    petId: account.petId,
    accessToken: account.accessToken,
    passcode: taskBoardPasscodeForRole(account.role, account.passcode),
    source: "account"
  };
}

export function getSession(): AccountSession | null {
  if (typeof window === "undefined") return null;
  try {
    const current = localStorage.getItem(SESSION_KEY);
    const legacy = current === null ? localStorage.getItem(LEGACY_SESSION_KEY) : null;
    const parsed = JSON.parse(current ?? legacy ?? "null");
    if (parsed?.source === "account") {
      const session = {
        ...parsed,
        passcode: taskBoardPasscodeForRole(parsed.role, parsed.passcode)
      } as AccountSession;
      if (legacy !== null || session.passcode !== parsed.passcode) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
      if (legacy !== null) localStorage.removeItem(LEGACY_SESSION_KEY);
      return session;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(account: Account): AccountSession {
  const session = sessionForAccount(account);
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function logout(): void {
  localStorage.removeItem(SESSION_KEY);
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_SESSION_KEY) ?? "null");
    if (legacy?.source === "account") localStorage.removeItem(LEGACY_SESSION_KEY);
  } catch {
    // Leave unrelated or corrupt task-board state alone.
  }
}
