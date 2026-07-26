import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { AppRoot } from "../../components/AppRoot";
import { isLocalProofHost } from "./loadingProofHost";

export default async function LoadingProofPage() {
  const host = (await headers()).get("host");
  if (!isLocalProofHost(host)) notFound();

  return <AppRoot audience="customer" openingDelayMs={1200} />;
}
