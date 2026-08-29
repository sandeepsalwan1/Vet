import { ArrivalIntake } from "../components/ArrivalIntake";
import { ClinicProvider } from "../components/ClinicContext";

export default function ArrivalPage() {
  return (
    <ClinicProvider>
      <ArrivalIntake />
    </ClinicProvider>
  );
}
