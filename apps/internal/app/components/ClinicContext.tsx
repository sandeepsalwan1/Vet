"use client";

import { PawPrint } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  defaultClinicBrand,
  readClinicBrand,
  type ClinicBrand
} from "../lib/clinicClient";

const ClinicContext = createContext<ClinicBrand>(defaultClinicBrand);

function shortClinicName(name: string) {
  return name
    .replace(/\bHospital\b/gi, "")
    .replace(/\bVeterinary\b/gi, "Vet")
    .replace(/\s+/g, " ")
    .trim() || name;
}

export function ClinicProvider({ children }: { children: ReactNode }) {
  const [brand, setBrand] = useState<ClinicBrand | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    readClinicBrand()
      .then((nextBrand) => {
        if (!cancelled) setBrand(nextBrand);
      })
      .catch(() => {
        if (cancelled) return;
        const local = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
        if (local) {
          setBrand(defaultClinicBrand);
          return;
        }
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!brand) {
    return (
      <main className="entryShell">
        <section className="entryPanel clinicResolutionPanel">
          <PawPrint aria-hidden="true" />
          <h1>{failed ? "Clinic unavailable" : "Opening clinic"}</h1>
          <p>
            {failed
              ? "This domain is not connected to a hospital."
              : "Loading the hospital workspace."}
          </p>
        </section>
      </main>
    );
  }

  return <ClinicContext.Provider value={brand}>{children}</ClinicContext.Provider>;
}

export function useClinicBrand() {
  const brand = useContext(ClinicContext);
  return useMemo(() => ({
    ...brand,
    shortName: shortClinicName(brand.name)
  }), [brand]);
}
