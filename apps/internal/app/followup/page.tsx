import { ClinicProvider } from "../components/ClinicContext";
import { PublicAgentFlow } from "../components/PublicAgentFlow";

export default function FollowupPage() {
  return (
    <ClinicProvider>
      <PublicAgentFlow workflow="followup" />
    </ClinicProvider>
  );
}
