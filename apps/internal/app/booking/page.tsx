import { ClinicProvider } from "../components/ClinicContext";
import { PublicAgentFlow } from "../components/PublicAgentFlow";

export default function BookingPage() {
  return (
    <ClinicProvider>
      <PublicAgentFlow workflow="booking" />
    </ClinicProvider>
  );
}
