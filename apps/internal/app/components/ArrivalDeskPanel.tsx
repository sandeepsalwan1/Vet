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
  RefreshCw,
  Save,
  Sparkles,
  SprayCan,
  Stethoscope
} from "lucide-react";
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
  const {
    desk,
    settingsDraft,
    loading,
    saving,
    arrivalsByRoom,
    load,
    updateRoomState,
    checkout,
    saveSettings,
    updateSettingsDraft
  } = useArrivalDeskState({ session, actorQuery, onError });

  return (
    <section className="arrivalDeskPanel">
      <div className="arrivalDeskHeader">
        <div>
          <p className="eyebrow">Arrival Intake</p>
          <h2>Rooms and check-ins</h2>
        </div>
        <button className="plainButton compact" type="button" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="spinIcon" size={15} /> : <RefreshCw size={15} />}
          Refresh
        </button>
      </div>

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

      <div className="arrivalOpsGrid">
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
        ) : null}
      </div>
    </section>
  );
}
