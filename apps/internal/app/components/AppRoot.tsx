"use client";

import { useEffect, useState } from "react";
import { getSession, logout, type AccountSession } from "../lib/accountStore";
import { validateAccountTeamSession } from "../lib/authClient";
import { AdminDashboard } from "./admin/AdminDashboard";
import { AuthScreen, type Audience } from "./auth/AuthScreen";
import { ClinicProvider, useClinicBrand } from "./ClinicContext";
import { CustomerExperience } from "./customer/CustomerExperience";
import { TaskBoard } from "./TaskBoard";
import {
  clearStoredTaskBoardSession,
  writeStoredTaskBoardSession
} from "./taskBoardBrowserState";

// Two doors, one app:
// - "/"      → pet owners (the chat portal)
// - "/staff" → the clinic team (task board for staff/vets, dashboard for admins)
// Each door only signs in its own audience; a session for the other door is
// bounced to where it belongs so the two surfaces never blur together.
type View =
  | { kind: "loading" }
  | { kind: "auth" }
  | { kind: "redirecting" }
  | { kind: "board" } // staff / VA / veterinarian on the shared task board
  | { kind: "customer"; session: AccountSession }
  | { kind: "admin"; session: AccountSession & { role: "admin" } };

const HOME_PATH = "/";
const STAFF_PATH = "/staff";

function audienceForRole(role: AccountSession["role"]): Audience {
  return role === "customer" ? "customer" : "staff";
}

function isAdminSession(session: AccountSession): session is AccountSession & { role: "admin" } {
  return session.role === "admin";
}

// A staff/vet/admin account drives the task board through the passcode session
// it shares with the API. Mirror the account into that session so the
// team never has to sign in twice.
function bridgeToBoardSession(session: AccountSession) {
  if (session.role === "customer") return;
  const role = session.role === "veterinarian" ? "veterinarian" : session.role;
  writeStoredTaskBoardSession({
    name: session.name,
    role,
    passcode: session.passcode,
    profileId: null
  });
}

function viewForSession(session: AccountSession): View {
  if (session.role === "customer") return { kind: "customer", session };
  if (isAdminSession(session)) return { kind: "admin", session };
  bridgeToBoardSession(session);
  return { kind: "board" };
}

async function resolveViewForSession(session: AccountSession): Promise<View> {
  if (session.role !== "customer") {
    const validation = await validateAccountTeamSession(session);
    if (validation === "invalid") {
      logout();
      clearStoredTaskBoardSession();
      return { kind: "board" };
    }
  }
  return viewForSession(session);
}

function AppRootContent({ audience }: { audience: Audience }) {
  const [view, setView] = useState<View>({ kind: "loading" });
  const clinic = useClinicBrand();

  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      void (async () => {
        const session = getSession();
        if (!session) {
          if (!cancelled) setView({ kind: "auth" });
          return;
        }
        if (audienceForRole(session.role) !== audience) {
          if (!cancelled) setView({ kind: "redirecting" });
          window.location.replace(audience === "customer" ? STAFF_PATH : HOME_PATH);
          return;
        }
        const nextView = await resolveViewForSession(session);
        if (!cancelled) setView(nextView);
      })();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [audience]);

  function handleAuth(session: AccountSession) {
    if (audienceForRole(session.role) !== audience) {
      setView({ kind: "redirecting" });
      window.location.replace(audienceForRole(session.role) === "customer" ? HOME_PATH : STAFF_PATH);
      return;
    }
    setView({ kind: "loading" });
    void resolveViewForSession(session).then(setView);
  }

  function handleOpenBoard() {
    // Admins jump to the board from their dashboard; signed-out users reach it
    // through the passcode link. Bridge the account session when there is one.
    const session = getSession();
    if (session) bridgeToBoardSession(session);
    setView({ kind: "board" });
  }

  function handleLogout() {
    logout();
    clearStoredTaskBoardSession();
    setView({ kind: "auth" });
  }

  if (view.kind === "loading" || view.kind === "redirecting") {
    return (
      <main className="entryShell">
        <section className="entryPanel bootPanel">
          <p className="eyebrow">{clinic.name}</p>
          <h1>{view.kind === "redirecting" ? "Taking you there…" : "Opening…"}</h1>
          <div className="bootBar" aria-hidden="true" />
        </section>
      </main>
    );
  }

  if (view.kind === "auth") {
    return <AuthScreen audience={audience} onAuth={handleAuth} onOpenPasscodeBoard={handleOpenBoard} />;
  }

  if (view.kind === "board") {
    return <TaskBoard />;
  }

  if (view.kind === "customer") {
    return <CustomerExperience session={view.session} onLogout={handleLogout} />;
  }

  if (view.kind === "admin") {
    return (
      <AdminDashboard
        session={view.session}
        onLogout={handleLogout}
        onOpenBoard={handleOpenBoard}
      />
    );
  }

  handleLogout();
  return <AuthScreen audience={audience} onAuth={handleAuth} onOpenPasscodeBoard={handleOpenBoard} />;
}

export function AppRoot({ audience = "customer" }: { audience?: Audience }) {
  return (
    <ClinicProvider>
      <AppRootContent audience={audience} />
    </ClinicProvider>
  );
}
