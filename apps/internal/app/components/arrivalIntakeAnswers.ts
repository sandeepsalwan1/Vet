import type { ArrivalQuestionnaire, ArrivalSettings } from "@central-vet/db";

export type ArrivalAnswerState = {
  sickSigns: string[];
  otherSigns: string;
  specialConcerns: string;
  vaccineFeeling: string;
  surgeryAte: string;
  surgeryFeeling: string;
  dentalConcern: string;
  routineConcern: string;
};

export const fallbackArrivalQuestionnaire: ArrivalQuestionnaire = {
  visitReasons: ["Sick", "Vaccines", "Surgery", "Dental", "Routine"],
  sickSignsLabel: "What signs are you seeing?",
  sickSigns: ["Vomiting", "Diarrhea", "Coughing", "Other signs"],
  specialConcernsLabel: "Any special concerns?",
  vaccineFeelingLabel: "How is your pet feeling today?",
  surgeryAteLabel: "Did your pet eat today?",
  surgeryFeelingLabel: "How is your pet feeling today?",
  dentalConcernLabel: "Any dental concerns today?",
  routineConcernLabel: "Scratching, itching, routine vaccines, or anything else?"
};

export const blankArrivalAnswers: ArrivalAnswerState = {
  sickSigns: [],
  otherSigns: "",
  specialConcerns: "",
  vaccineFeeling: "",
  surgeryAte: "",
  surgeryFeeling: "",
  dentalConcern: "",
  routineConcern: ""
};

export function inferArrivalVisitReason(appointmentType: string, options: string[]) {
  const lower = appointmentType.toLowerCase();
  const find = (needle: string) => options.find((option) => option.toLowerCase().includes(needle));
  if (/sick|ill|urgent/.test(lower)) return find("sick") ?? options[0];
  if (/vacc|shot|booster/.test(lower)) return find("vacc") ?? options[0];
  if (/surg|spay|neuter|procedure/.test(lower)) return find("surg") ?? options[0];
  if (/dental|tooth|teeth/.test(lower)) return find("dental") ?? options[0];
  return find("routine") ?? options[0];
}

export function arrivalReasonKey(reason: string) {
  const lower = reason.toLowerCase();
  if (lower.includes("sick")) return "sick";
  if (lower.includes("vacc")) return "vaccines";
  if (lower.includes("surg")) return "surgery";
  if (lower.includes("dental")) return "dental";
  return "routine";
}

export function arrivalAnswerPayload(reason: string, answers: ArrivalAnswerState): Record<string, unknown> {
  const key = arrivalReasonKey(reason);
  if (key === "sick") {
    return {
      signs: answers.sickSigns,
      otherSigns: answers.otherSigns,
      specialConcerns: answers.specialConcerns
    };
  }
  if (key === "vaccines") return { feelingToday: answers.vaccineFeeling };
  if (key === "surgery") {
    return {
      ateToday: answers.surgeryAte,
      feelingToday: answers.surgeryFeeling
    };
  }
  if (key === "dental") return { concerns: answers.dentalConcern };
  return { concerns: answers.routineConcern };
}

export function resolvePublicArrivalSettings(data: { settings?: ArrivalSettings }): ArrivalSettings {
  return {
    roomAssignmentEnabled: data.settings?.roomAssignmentEnabled ?? true,
    questionnaire: {
      ...fallbackArrivalQuestionnaire,
      ...(data.settings?.questionnaire ?? {})
    }
  };
}
