import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { isLocalProofHost } from "../../lib/proofHost";
import { LoadingProofClient } from "./LoadingProofClient";

export const dynamic = "force-dynamic";

export default async function LoadingProofPage() {
  const host = (await headers()).get("host");
  if (!isLocalProofHost(host)) {
    notFound();
  }

  return (
    <LoadingProofClient />
  );
}
