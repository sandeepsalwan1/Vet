import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LoadingProofClient } from "./LoadingProofClient";
import { isLocalProofHost } from "./_proofLoading";

export default async function LoadingProofPage() {
  const host = (await headers()).get("host");
  if (!isLocalProofHost(host)) notFound();
  return <LoadingProofClient />;
}
