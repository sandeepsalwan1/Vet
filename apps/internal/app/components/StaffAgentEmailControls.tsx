"use client";

import { useState } from "react";

type StaffAgentEmailMode = "disabled" | "test" | "production";
type StaffAgentEmailCadence = "once" | "monthly" | "post_appointment";

type StaffAgentEmailPayload = {
  mode: StaffAgentEmailMode;
  cadence: StaffAgentEmailCadence;
  templateReviewed: boolean;
  confirmed: boolean;
  postAppointmentDelayDays: number;
};

export function useStaffAgentEmailOptions() {
  const [mode, setMode] = useState<StaffAgentEmailMode>("disabled");
  const [cadence, setCadence] = useState<StaffAgentEmailCadence>("monthly");
  const [templateReviewed, setTemplateReviewed] = useState(false);
  const [productionConfirmed, setProductionConfirmed] = useState(false);
  const [postAppointmentDelayDays, setPostAppointmentDelayDays] = useState(7);

  return {
    mode,
    cadence,
    templateReviewed,
    productionConfirmed,
    postAppointmentDelayDays,
    setMode,
    setCadence,
    setTemplateReviewed,
    setProductionConfirmed,
    setPostAppointmentDelayDays,
    payload: {
      mode,
      cadence,
      templateReviewed,
      confirmed: productionConfirmed,
      postAppointmentDelayDays
    } satisfies StaffAgentEmailPayload
  };
}

type StaffAgentEmailOptions = ReturnType<typeof useStaffAgentEmailOptions>;

export function StaffAgentEmailControls({ options }: { options: StaffAgentEmailOptions }) {
  return (
    <div className="staffAgentControls">
      <label>
        Email mode
        <select value={options.mode} onChange={(event) => options.setMode(event.target.value as StaffAgentEmailMode)}>
          <option value="disabled">disabled</option>
          <option value="test">test</option>
          <option value="production">production</option>
        </select>
      </label>
      <label>
        Cadence
        <select value={options.cadence} onChange={(event) => options.setCadence(event.target.value as StaffAgentEmailCadence)}>
          <option value="once">once</option>
          <option value="monthly">monthly</option>
          <option value="post_appointment">post-appointment</option>
        </select>
      </label>
      {options.cadence === "post_appointment" ? (
        <label>
          Delay days
          <input
            type="number"
            min={1}
            max={90}
            value={options.postAppointmentDelayDays}
            onChange={(event) => options.setPostAppointmentDelayDays(Number(event.target.value) || 7)}
          />
        </label>
      ) : null}
      <label className="toggleLine">
        <input
          type="checkbox"
          checked={options.templateReviewed}
          onChange={(event) => options.setTemplateReviewed(event.target.checked)}
        />
        Template reviewed
      </label>
      <label className="toggleLine">
        <input
          type="checkbox"
          checked={options.productionConfirmed}
          onChange={(event) => options.setProductionConfirmed(event.target.checked)}
        />
        Production confirmed
      </label>
    </div>
  );
}
