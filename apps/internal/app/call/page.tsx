import { ClinicProvider } from "../components/ClinicContext";
import { PublicAgentFlow } from "../components/PublicAgentFlow";

export default function CallPage() {
  return (
    <ClinicProvider>
      <PublicAgentFlow workflow="call" />
    </ClinicProvider>
  );
}
