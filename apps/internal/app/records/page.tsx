import { ClinicProvider } from "../components/ClinicContext";
import { PublicAgentFlow } from "../components/PublicAgentFlow";

export default function RecordsPage() {
  return (
    <ClinicProvider>
      <PublicAgentFlow workflow="records" />
    </ClinicProvider>
  );
}
