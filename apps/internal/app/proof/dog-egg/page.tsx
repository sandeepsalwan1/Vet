import { notFound } from "next/navigation";
import { isLocalProofHost } from "../_proofHost";
import { DogEggProofView } from "./DogEggProofView";

export default async function DogEggProofPage() {
  const { headers } = await import("next/headers");
  const host = (await headers()).get("host");
  if (!isLocalProofHost(host)) {
    notFound();
  }

  return <DogEggProofView />;
}
