"use client";

import { ClinicWordmark } from "./ClinicWordmark";

export function BootPanel({
  clinicName,
  line,
  proofHold
}: {
  clinicName: string;
  line: string;
  proofHold?: boolean;
}) {
  return (
    <main className="entryShell">
      <section className="entryPanel bootPanel" aria-live="polite">
        <ClinicWordmark name={clinicName} />
        <p className="bootLine">{line}</p>
        {proofHold ? <div aria-hidden="true" data-agent-proof="loading-hold" /> : null}
      </section>
    </main>
  );
}
