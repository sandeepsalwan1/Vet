"use client";

import { useEffect, useState } from "react";
import { AppRoot } from "../../components/AppRoot";
import { ClinicWordmark } from "../../components/ClinicWordmark";
import { defaultClinicBrand } from "../../lib/clinicClient";

export function LoadingProofClient() {
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setShowAuth(true), 1400);
    return () => window.clearTimeout(id);
  }, []);

  if (showAuth) {
    return <AppRoot audience="customer" />;
  }

  return (
    <main className="entryShell">
      <section className="entryPanel bootPanel" aria-live="polite">
        <ClinicWordmark name={defaultClinicBrand.name} />
        <p className="bootLine">Opening your clinic…</p>
        <div aria-hidden="true" data-agent-proof="loading-hold" />
      </section>
    </main>
  );
}
