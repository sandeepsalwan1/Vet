"use client";

import { Stethoscope } from "lucide-react";

export function ClinicWordmark({ name }: { name: string }) {
  return (
    <div className="clinicWordmark" role="img" aria-label={name}>
      <span className="clinicWordmarkMark" aria-hidden="true">
        <Stethoscope />
      </span>
      <span className="clinicWordmarkCopy">
        <strong>{name}</strong>
        <small>Clinic workspace</small>
      </span>
    </div>
  );
}
