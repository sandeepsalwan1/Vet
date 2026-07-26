"use client";

import { useEffect, useState } from "react";
import { AuthScreen } from "../../components/auth/AuthScreen";
import { OpeningPanel } from "../../components/AppRoot";
import { useClinicBrand } from "../../components/ClinicContext";

const OPENING_DELAY_MS = 1600;

export function LoadingProofClient() {
  const [ready, setReady] = useState(false);
  const clinic = useClinicBrand();

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), OPENING_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!ready) {
    return <div data-agent-proof="opening"><OpeningPanel clinicName={clinic.name} message="Opening your clinic…" /></div>;
  }

  return (
    <div data-agent-proof="signin">
      <AuthScreen audience="customer" onAuth={() => undefined} onOpenPasscodeBoard={() => undefined} />
    </div>
  );
}
