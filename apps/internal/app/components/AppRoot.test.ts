import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("customer landing copy uses the opening clinic panel", () => {
  const clinicContextSource = readSource("./ClinicContext.tsx");
  const appRootSource = readSource("./AppRoot.tsx");
  const authScreenSource = readSource("./auth/AuthScreen.tsx");

  assert.match(clinicContextSource, /Opening your clinic…/);
  assert.match(clinicContextSource, /data-agent-proof-state=\{failed \? "failed" : "loading"\}/);
  assert.match(appRootSource, /if \(view\.kind === "loading"\) \{\s+return <ClinicLoadingPanel \/>\;/s);
  assert.match(authScreenSource, /data-agent-proof="signin"/);
  assert.match(authScreenSource, /data-agent-proof-state="complete"/);
  assert.doesNotMatch(appRootSource, /PROOF_DELAY_MS|1200/);
});

test("proof loading still reaches the welcome back auth state", () => {
  const proofViewSource = readSource("../proof/loading/ProofLoadingView.tsx");
  const customerAuthSource = readSource("./auth/CustomerAuthForms.tsx");

  assert.match(proofViewSource, /PROOF_DELAY_MS = 1200/);
  assert.match(proofViewSource, /return <AuthScreen audience="customer" onAuth=\{\(\) => undefined\} onOpenPasscodeBoard=\{\(\) => undefined\} \/>\;/s);
  assert.match(customerAuthSource, /Welcome back/);
});
