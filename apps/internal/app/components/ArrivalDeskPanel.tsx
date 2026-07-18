"use client";

import type {
  ArrivalIntake,
  RoomState
} from "@central-vet/db";
import {
  ClipboardCheck,
  DoorClosed,
  DoorOpen,
  Loader2,
  Save,
  Sparkles,
  SprayCan,
  Stethoscope,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { canAdmin } from "../lib/taskWorkflow";
import type { TaskBoardSession } from "./taskBoardTypes";
import { useArrivalDeskState } from "./useArrivalDeskState";

type Props = {
  session: TaskBoardSession;
  actorQuery: string;
  onError: (message: string) => void;
};

const roomStates: { state: RoomState; label: string }[] = [
  { state: "open", label: "Open" },
  { state: "occupied", label: "Occupied" },
  { state: "cleaning", label: "Cleaning" },
  { state: "closed", label: "Closed" }
];

function roomIcon(state: RoomState) {
  if (state === "open") return DoorOpen;
  if (state === "cleaning") return SprayCan;
  return DoorClosed;
}

function answerSummary(arrival: ArrivalIntake) {
  const entries = Object.entries(arrival.answers ?? {});
  if (!entries.length) return "No answers";
  return entries
    .map(([key, value]) => {
      const text = Array.isArray(value) ? value.join(", ") : String(value ?? "");
      return text ? `${key}: ${text}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

export function ArrivalDeskPanel({ session, actorQuery, onError }: Props) {
  const [open, setOpen] = useState(false);
  const {
    desk,
    settingsDraft,
    loading,
    saving,
    arrivalsByRoom,
    updateRoomState,
    checkout,
    saveSettings,
    updateSettingsDraft
  } = useArrivalDeskState({ session, actorQuery, onError });

  const occupancy = useMemo(() => {
    const rooms = desk?.rooms ?? [];
    const occupied = rooms.filter((room) => room.state === "occupied").length;
    return {
      occupied,
      total: rooms.length,
      pressured: rooms.length > 0 && occupied * 3 >= rooms.length * 2
    };
  }, [desk]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <>
      <section className="arrivalDeskLauncher" aria-label="Arrival intake">
        <button className="arrivalDeskLaunchButton" type="button" onClick={() => setOpen(true)}>
          <DoorOpen size={18} />
          <span>Rooms &amp; check-ins</span>
          <small>{loading && !desk ? <Loader2 className="spinIcon" size={13} /> : `${occupancy.occupied}/${occupancy.total} occupied`}</small>
        </button>
        {occupancy.pressured ? <span className="arrivalPressureWarning">Room capacity above two-thirds</span> : null}
      </section>

      {open ? (
        <div
          className="arrivalDeskBackdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section className="arrivalDeskDialog" role="dialog" aria-modal="true" aria-labelledby="arrival-desk-title">
            <div className="arrivalDeskHeader arrivalDialogHeader">
              <div>
                <p className="eyebrow">Arrival intake</p>
                <h2 id="arrival-desk-title">Rooms and check-ins</h2>
              </div>
              <button className="iconButton" type="button" onClick={() => setOpen(false)} title="Close rooms and check-ins">
                <X size={18} />
              </button>
            </div>

            <div className="arrivalDialogBody">
              <div className="arrivalRoomGrid">
                {(desk?.rooms ?? []).map((room) => {
                  const Icon = roomIcon(room.state);
                  const arrival = room.currentArrivalId ? arrivalsByRoom.get(room.id) : null;
                  return (
                    <article className={`arrivalRoomCard room-${room.state}`} key={room.id}>
                      <div className="arrivalRoomTop">
                        <Icon size={19} />
                        <div>
                          <strong>{room.name}</strong>
                          <span>{room.state}</span>
                        </div>
                      </div>
                      {arrival ? <p>{arrival.petName} · {arrival.visitReason}</p> : <p>No patient assigned</p>}
                      <div className="arrivalRoomActions">
                        {roomStates.map((item) => (
                          <button
                            key={item.state}
                            type="button"
                            className={room.state === item.state ? "selected" : ""}
                            disabled={saving}
                            onClick={() => void updateRoomState(room.id, item.state)}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className={`arrivalOpsGrid ${canAdmin(session.role) && settingsDraft ? "" : "arrivalOpsGrid--single"}`}>
                <section className="arrivalListPanel">
                  <div className="arrivalMiniHeader">
                    <ClipboardCheck size={17} />
                    <h3>Today</h3>
                    <span>{desk?.arrivals.length ?? 0}</span>
                  </div>
                  <div className="arrivalList">
                    {(desk?.arrivals ?? []).map((arrival) => (
                      <article className={`arrivalListItem arrival-${arrival.status}`} key={arrival.id}>
                        <div className="arrivalListTop">
                          <div>
                            <strong>{arrival.petName || "Unmatched pet"}</strong>
                            <span>{arrival.clientName || "Client"} · {arrival.clientPhone || "No phone"}</span>
                          </div>
                          <em>{arrival.status === "checked_in" ? arrival.roomName || "No room" : "Front desk"}</em>
                        </div>
                        <p>{arrival.status === "checked_in" ? answerSummary(arrival) : arrival.exceptionReason}</p>
                        <div className="arrivalListActions">
                          <span><Stethoscope size={13} /> {arrival.visitReason || "Match needed"}</span>
                          {arrival.roomId && arrival.status === "checked_in" ? (
                            <button type="button" onClick={() => void checkout(arrival.id)} disabled={saving}>
                              Payment done
                            </button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                    {desk && desk.arrivals.length === 0 ? <div className="emptyLane">No arrivals yet</div> : null}
                  </div>
                </section>

                {canAdmin(session.role) && settingsDraft ? (
                  <details className="arrivalSettingsDisclosure">
                    <summary>Check-in form settings</summary>
                    <form
                      className="arrivalSettingsPanel"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveSettings();
                      }}
                    >
                      <div className="arrivalMiniHeader">
                        <Sparkles size={17} />
                        <h3>Admin defaults</h3>
                      </div>
                      <label className="arrivalToggleLine">
                        <input
                          type="checkbox"
                          checked={settingsDraft.roomAssignmentEnabled}
                          onChange={(event) => updateSettingsDraft({ roomAssignmentEnabled: event.target.checked })}
                        />
                        Auto-assign open rooms
                      </label>
                      <label>
                        Visit reasons
                        <input
                          value={settingsDraft.visitReasonsText}
                          onChange={(event) => updateSettingsDraft({ visitReasonsText: event.target.value })}
                        />
                      </label>
                      <label>
                        Sick signs
                        <input
                          value={settingsDraft.sickSignsText}
                          onChange={(event) => updateSettingsDraft({ sickSignsText: event.target.value })}
                        />
                      </label>
                      <label>
                        Sick question
                        <input value={settingsDraft.sickSignsLabel} onChange={(event) => updateSettingsDraft({ sickSignsLabel: event.target.value })} />
                      </label>
                      <label>
                        Vaccines question
                        <input value={settingsDraft.vaccineFeelingLabel} onChange={(event) => updateSettingsDraft({ vaccineFeelingLabel: event.target.value })} />
                      </label>
                      <label>
                        Surgery food question
                        <input value={settingsDraft.surgeryAteLabel} onChange={(event) => updateSettingsDraft({ surgeryAteLabel: event.target.value })} />
                      </label>
                      <button className="primaryButton" type="submit" disabled={saving}>
                        {saving ? <Loader2 className="spinIcon" size={17} /> : <Save size={17} />}
                        Save check-in form
                      </button>
                    </form>
                  </details>
                ) : null}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
