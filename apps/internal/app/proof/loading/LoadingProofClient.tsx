"use client";

import { useEffect, useState } from "react";
import { AppRoot } from "../../components/AppRoot";
import { BootPanel } from "../../components/BootPanel";
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

  return <BootPanel clinicName={defaultClinicBrand.name} line="Opening your clinic…" proofHold />;
}
