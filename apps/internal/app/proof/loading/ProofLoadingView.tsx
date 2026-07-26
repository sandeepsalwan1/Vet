"use client";

import { useEffect, useState } from "react";
import { AuthScreen } from "../../components/auth/AuthScreen";
import { ClinicLoadingPanel } from "../../components/ClinicContext";

const PROOF_DELAY_MS = 1200;

export function ProofLoadingView() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setReady(true), PROOF_DELAY_MS);
    return () => window.clearTimeout(id);
  }, []);

  if (!ready) {
    return <ClinicLoadingPanel />;
  }

  return <AuthScreen audience="customer" onAuth={() => undefined} onOpenPasscodeBoard={() => undefined} />;
}
