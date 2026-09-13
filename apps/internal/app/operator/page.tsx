import type { Metadata } from "next";
import { platformOperatorConfigured } from "../lib/server/platformOperatorAuth";
import { OperatorExperience } from "./OperatorExperience";

export const metadata: Metadata = {
  title: "Vet Product Pulse",
  description: "Private product health view",
  robots: { index: false, follow: false }
};

export const dynamic = "force-dynamic";

export default function OperatorPage() {
  return <OperatorExperience configured={platformOperatorConfigured()} />;
}
