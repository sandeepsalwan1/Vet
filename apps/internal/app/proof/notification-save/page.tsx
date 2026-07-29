import { notFound } from "next/navigation";
import { isLocalProofHost } from "../_proofHost";
import { ProofNotificationSaveView } from "./ProofNotificationSaveView";

export default async function ProofNotificationSavePage() {
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host");
  if (!isLocalProofHost(host)) {
    notFound();
  }

  return <ProofNotificationSaveView />;
}
