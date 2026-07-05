"use client";

import {
  BadgeCheck,
  ClipboardCheck,
  DoorOpen,
  Loader2,
  Lock,
  LogIn,
  PawPrint,
  Phone,
  Send,
  Stethoscope,
  UserRound
} from "lucide-react";
import { ArrivalQuestionFields } from "./ArrivalQuestionFields";
import { useClinicBrand } from "./ClinicContext";
import { useArrivalIntakeFlow, type ArrivalStep } from "./useArrivalIntakeFlow";

function railState(step: ArrivalStep, target: number) {
  if (step === "exception") return target === 0 ? "active" : "";
  const index = step === "identity" ? 0 : step === "questions" ? 1 : 2;
  if (target < index) return "done";
  if (target === index) return step === "done" ? "done" : "active";
  return "";
}

export function ArrivalIntake() {
  const clinic = useClinicBrand();
  const {
    step,
    identity,
    identityComplete,
    match,
    visitReason,
    setVisitReason,
    answers,
    arrival,
    message,
    error,
    loading,
    questionnaire,
    updateIdentity,
    updateAnswer,
    toggleSign,
    submitIdentity,
    submitQuestions
  } = useArrivalIntakeFlow();

  return (
    <main className="arrivalShell">
      <section className="arrivalHero">
        <div className="arrivalBrand">
          <PawPrint size={22} />
          <span>{clinic.name}</span>
        </div>
        <div className="arrivalHeroText">
          <p>Arrival</p>
          <h1>Check in before the front desk line.</h1>
        </div>
        <div className="arrivalStepRail" aria-label="Check-in steps">
          <span className={railState(step, 0)}>Match</span>
          <span className={railState(step, 1)}>Questions</span>
          <span className={railState(step, 2)}>Room</span>
        </div>
      </section>

      <section className="arrivalCard">
        {step === "identity" ? (
          <form
            className="arrivalForm"
            onSubmit={(event) => {
              event.preventDefault();
              void submitIdentity();
            }}
          >
            <div className="arrivalCardHeader">
              <UserRound size={22} />
              <div>
                <h2>Find today&apos;s appointment</h2>
                <p>Use the phone number on the clinic record.</p>
              </div>
            </div>
            {identity.loggedIn ? (
              <div className="arrivalLockedBox">
                <Lock size={17} />
                <span>{identity.clientName} · {identity.petName || "Pet"} · {identity.clientPhone || "Verified phone"}</span>
              </div>
            ) : (
              <a className="arrivalSignin" href="/">
                <LogIn size={16} />
                Sign in for autofill
              </a>
            )}
            <div className="arrivalGrid">
              <label>
                Last name
                <input
                  value={identity.lastName}
                  onChange={(event) => updateIdentity("lastName", event.target.value)}
                  autoFocus={!identity.loggedIn}
                  disabled={identity.loggedIn}
                />
              </label>
              <label>
                Phone
                <input
                  value={identity.clientPhone}
                  onChange={(event) => updateIdentity("clientPhone", event.target.value)}
                  inputMode="tel"
                  disabled={identity.loggedIn}
                />
              </label>
              <label>
                Pet name
                <input
                  value={identity.petName}
                  onChange={(event) => updateIdentity("petName", event.target.value)}
                  disabled={identity.loggedIn && Boolean(identity.petName)}
                />
              </label>
            </div>
            {error ? <div className="errorBox">{error}</div> : null}
            <button className="arrivalPrimary" type="submit" disabled={loading || !identityComplete}>
              {loading ? <Loader2 className="spinIcon" size={18} /> : <BadgeCheck size={18} />}
              {loading ? "Matching" : "Continue"}
            </button>
          </form>
        ) : null}

        {step === "questions" && match ? (
          <form
            className="arrivalForm"
            onSubmit={(event) => {
              event.preventDefault();
              void submitQuestions();
            }}
          >
            <div className="arrivalCardHeader">
              <Stethoscope size={22} />
              <div>
                <h2>{match.petName}</h2>
                <p>{match.appointmentTime} · {match.appointmentType} · {match.doctor}</p>
              </div>
            </div>
            <fieldset className="arrivalReasonPicker">
              <legend>Visit reason</legend>
              {questionnaire.visitReasons.map((reason) => (
                <button
                  key={reason}
                  className={visitReason === reason ? "selected" : ""}
                  type="button"
                  onClick={() => setVisitReason(reason)}
                >
                  {reason}
                </button>
              ))}
            </fieldset>

            <ArrivalQuestionFields
              questionnaire={questionnaire}
              visitReason={visitReason}
              answers={answers}
              onAnswer={updateAnswer}
              onToggleSign={toggleSign}
            />

            {error ? <div className="errorBox">{error}</div> : null}
            <button className="arrivalPrimary" type="submit" disabled={loading}>
              {loading ? <Loader2 className="spinIcon" size={18} /> : <Send size={18} />}
              {loading ? "Checking in" : "Check in"}
            </button>
          </form>
        ) : null}

        {step === "done" ? (
          <div className="arrivalDone">
            <div className="arrivalDoneIcon">
              {arrival?.roomName ? <DoorOpen size={34} /> : <ClipboardCheck size={34} />}
            </div>
            <h2>{message}</h2>
            <p>{arrival?.pimsWriteSummary ? "Saved to the clinic workflow." : "Saved for the clinic team."}</p>
            <div className="arrivalDoneMeta">
              <span><PawPrint size={14} /> {arrival?.petName}</span>
              <span><Phone size={14} /> {arrival?.clientPhone}</span>
              {arrival?.roomName ? <span><DoorOpen size={14} /> {arrival.roomName}</span> : null}
            </div>
          </div>
        ) : null}

        {step === "exception" ? (
          <div className="arrivalDone arrivalException">
            <div className="arrivalDoneIcon">
              <UserRound size={34} />
            </div>
            <h2>{message || "Front desk help is ready."}</h2>
            <p>We saved your arrival so the clinic team can match the appointment.</p>
            <a className="arrivalSignin" href="/">
              <LogIn size={16} />
              Try signing in
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
