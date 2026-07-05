import { clinicBookingTools } from "./clinicBookingTools";
import { clinicFrontDeskTools } from "./clinicFrontDeskTools";
import { clinicLookupTools } from "./clinicLookupTools";

export const clinicTools = {
  ...clinicLookupTools,
  ...clinicBookingTools,
  ...clinicFrontDeskTools
};
