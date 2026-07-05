import type { ArrivalQuestionnaire } from "@central-vet/db";
import { arrivalReasonKey, type ArrivalAnswerState } from "./arrivalIntakeAnswers";

type Props = {
  questionnaire: ArrivalQuestionnaire;
  visitReason: string;
  answers: ArrivalAnswerState;
  onAnswer: (key: keyof ArrivalAnswerState, value: string) => void;
  onToggleSign: (sign: string) => void;
};

export function ArrivalQuestionFields({
  questionnaire,
  visitReason,
  answers,
  onAnswer,
  onToggleSign
}: Props) {
  const reasonKey = arrivalReasonKey(visitReason);

  if (reasonKey === "sick") {
    return (
      <div className="arrivalQuestionBlock">
        <fieldset className="arrivalChecklist">
          <legend>{questionnaire.sickSignsLabel}</legend>
          {questionnaire.sickSigns.map((sign) => (
            <label key={sign}>
              <input
                type="checkbox"
                checked={answers.sickSigns.includes(sign)}
                onChange={() => onToggleSign(sign)}
              />
              <span>{sign}</span>
            </label>
          ))}
        </fieldset>
        <label>
          Other signs
          <textarea rows={3} value={answers.otherSigns} onChange={(event) => onAnswer("otherSigns", event.target.value)} />
        </label>
        <label>
          {questionnaire.specialConcernsLabel}
          <textarea rows={4} value={answers.specialConcerns} onChange={(event) => onAnswer("specialConcerns", event.target.value)} />
        </label>
      </div>
    );
  }

  if (reasonKey === "vaccines") {
    return (
      <label>
        {questionnaire.vaccineFeelingLabel}
        <textarea rows={4} value={answers.vaccineFeeling} onChange={(event) => onAnswer("vaccineFeeling", event.target.value)} />
      </label>
    );
  }

  if (reasonKey === "surgery") {
    return (
      <div className="arrivalQuestionBlock">
        <label>
          {questionnaire.surgeryAteLabel}
          <input value={answers.surgeryAte} onChange={(event) => onAnswer("surgeryAte", event.target.value)} />
        </label>
        <label>
          {questionnaire.surgeryFeelingLabel}
          <textarea rows={4} value={answers.surgeryFeeling} onChange={(event) => onAnswer("surgeryFeeling", event.target.value)} />
        </label>
      </div>
    );
  }

  if (reasonKey === "dental") {
    return (
      <label>
        {questionnaire.dentalConcernLabel}
        <textarea rows={4} value={answers.dentalConcern} onChange={(event) => onAnswer("dentalConcern", event.target.value)} />
      </label>
    );
  }

  return (
    <label>
      {questionnaire.routineConcernLabel}
      <textarea rows={4} value={answers.routineConcern} onChange={(event) => onAnswer("routineConcern", event.target.value)} />
    </label>
  );
}
