import {
  DEMO_PASSCODES,
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
    passcode: taskBoardPasscodeForRole(account.role, account.passcode),
    source: "account"
  };
}

export function getSession(): AccountSession | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null");
    if (parsed?.source === "account") {
      const session = {
        ...parsed,
        passcode: taskBoardPasscodeForRole(parsed.role, parsed.passcode)
      } as AccountSession;
      if (session.passcode !== parsed.passcode) {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      }
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
}
