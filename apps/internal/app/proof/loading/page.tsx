import { notFound } from "next/navigation";
import { isLocalProofHost } from "../_proofHost";
import { ProofLoadingView } from "./ProofLoadingView";

export default async function ProofLoadingPage() {
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host");
  if (!isLocalProofHost(host)) {
    notFound();
  }

  return <ProofLoadingView />;
}
