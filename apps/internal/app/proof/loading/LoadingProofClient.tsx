"use client";

import { useEffect, useState } from "react";
import { BootPanel } from "../../components/BootPanel";
import { AuthScreen } from "../../components/auth/AuthScreen";
import { defaultClinicBrand } from "../../lib/clinicClient";

export function LoadingProofClient() {
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    const id = window.setTimeout(() => setShowAuth(true), 1400);
    return () => window.clearTimeout(id);
  }, []);

  if (showAuth) {
    return (
      <AuthScreen
        audience="customer"
        onAuth={() => undefined}
        onOpenPasscodeBoard={() => undefined}
      />
    );
  }

  return <BootPanel clinicName={defaultClinicBrand.name} line="Opening your clinic…" proofHold />;
}
