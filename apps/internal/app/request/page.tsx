import { ClinicProvider } from "../components/ClinicContext";
import { RequestForm } from "../components/RequestForm";

export default function RequestPage() {
  return (
    <ClinicProvider>
      <RequestForm />
    </ClinicProvider>
  );
}
