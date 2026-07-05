"use client";

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
  const [brand, setBrand] = useState<ClinicBrand>(defaultClinicBrand);

  useEffect(() => {
    let cancelled = false;
    readClinicBrand()
      .then((nextBrand) => {
        if (!cancelled) setBrand(nextBrand);
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, []);

  return <ClinicContext.Provider value={brand}>{children}</ClinicContext.Provider>;
}

export function useClinicBrand() {
  const brand = useContext(ClinicContext);
  return useMemo(() => ({
    ...brand,
    shortName: shortClinicName(brand.name)
  }), [brand]);
}
