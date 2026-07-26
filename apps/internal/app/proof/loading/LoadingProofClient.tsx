"use client";

import { useEffect, useState } from "react";
import { AuthScreen } from "../../components/auth/AuthScreen";
import { ClinicWordmark } from "../../components/ClinicWordmark";
import { defaultClinicBrand } from "../../lib/clinicClient";

const OPENING_DELAY_MS = 1600;

export function LoadingProofClient() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), OPENING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready) {
    return (
      <main className="entryShell" data-agent-proof="opening">
        <section className="entryPanel bootPanel">
          <ClinicWordmark name={defaultClinicBrand.name} />
          <p className="bootLine">Opening your clinic…</p>
        </section>
      </main>
    );
  }

  return (
    <div data-agent-proof="signin">
      <AuthScreen audience="customer" onAuth={() => undefined} onOpenPasscodeBoard={() => undefined} />
    </div>
  );
}
