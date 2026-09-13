import { ClinicProvider } from "../components/ClinicContext";
import { PublicAgentFlow } from "../components/PublicAgentFlow";

export default function PickupPage() {
  return (
    <ClinicProvider>
      <PublicAgentFlow workflow="pickup" />
    </ClinicProvider>
  );
}
