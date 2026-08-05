"use client";

import {
  AlertTriangle,
  BellRing,
  LogOut,
  Plus
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Task } from "@central-vet/db";
import { logout as clearAccountSession } from "../lib/accountStore";
import {
  canManage,
  canSeeEscalations,
  isOpenPriorityTask
} from "../lib/taskWorkflow";
import { TaskActivityPanel, TaskLaneGrid } from "./TaskBoardPanels";
import { ArrivalDeskPanel } from "./ArrivalDeskPanel";
import { ClientJourneyStaffPanel } from "./ClientJourneyStaffPanel";
import { useClinicBrand } from "./ClinicContext";
import { TaskForm } from "./TaskForm";
import { BootScreen, EntryScreen, MiniConfetti, SessionNameTag } from "./TaskBoardChrome";
import { NotificationSettingsMenu } from "./TaskBoardSettings";
import { InvalidTaskModal, TaskBoardToastBanner } from "./TaskBoardOverlays";
import { roleLabel } from "./taskBoardDisplay";
import type { TaskBoardToast } from "./taskBoardTypes";
import { useTaskBoardDataSync } from "./useTaskBoardDataSync";
import { useTaskBoardForm } from "./useTaskBoardForm";
import { useTaskBoardProfileName } from "./useTaskBoardProfileName";
import { useTaskBoardSettings } from "./useTaskBoardSettings";
import { useTaskBoardTaskActions } from "./useTaskBoardTaskActions";
import { filterTaskBoardTasks } from "./taskBoardDisplay";

export function TaskBoard() {
  const clinic = useClinicBrand();
  const {
    booted,
    session,
    setSession,
    tasks,
    setTasks,
    events,
    setEvents,
    loading,
    hasLoaded,
    syncPaused,
    error,
    setError,
    settingsRefreshToken,
    actorQuery,
    load,
    publishSync,
    saveSession,
    clearSession,
    markActive
  } = useTaskBoardDataSync();
  const [toast, setToast] = useState<TaskBoardToast | null>(null);
  const [invalidTask, setInvalidTask] = useState<Task | null>(null);
  const [invalidReason, setInvalidReason] = useState("");
  const [confetti, setConfetti] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const {
    settingsOpen,
    settingsSaving,
    endOfDayAlertsEnabled,
    recipientProfiles,
    canEditAllProfiles,
    currentProfileId,
    addingProfile,
    loadSettings,
    toggleSettingsOpen,
    toggleEndOfDayAlerts,
    saveRecipientProfile,
    deactivateRecipientProfile,
    startAddingProfile,
    setRecipientProfiles,
    setCurrentProfileId
  } = useTaskBoardSettings({
    session,
    actorQuery,
    clearSession,
    setSession,
    setError,
    setToast,
    publishSync
  });

  useEffect(() => {
    if (!session) return;
    void loadSettings();
  }, [loadSettings, session, settingsRefreshToken]);

  const clearInvalidTask = useCallback(() => {
    setInvalidTask(null);
    setInvalidReason("");
  }, []);

  const {
    updateStatus,
    archiveAction,
    escalate,
    undo
  } = useTaskBoardTaskActions({
    session,
    load,
    publishSync,
    setError,
    setToast,
    setConfetti,
    clearInvalidTask
  });

  function logout() {
    clearSession();
    clearAccountSession();
    window.location.assign("/staff");
  }

  const { updateSessionName } = useTaskBoardProfileName({
    session,
    recipientProfiles,
    currentProfileId,
    markActive,
    publishSync,
    setSession,
    setTasks,
    setEvents,
    setRecipientProfiles,
    setCurrentProfileId,
    setError,
    setToast
  });

  const {
    formOpen,
    formSaving,
    editing,
    form,
    setForm,
    openCreate,
    openEdit,
    closeForm,
    submitForm
  } = useTaskBoardForm({
    session,
    load,
    publishSync,
    setError,
    setToast
  });

  const openMediumHighCount = useMemo(
    () => tasks.filter(isOpenPriorityTask).length,
    [tasks]
  );
  const archivedTasks = useMemo(
    () => tasks
      .filter((task) => task.status === "archived")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [tasks]
  );
  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== "archived"), [tasks]);
  const visibleTasks = useMemo(() => filterTaskBoardTasks(activeTasks, searchQuery), [activeTasks, searchQuery]);
  const normalizedSearchQuery = searchQuery.trim();
  const hasSearchResults = normalizedSearchQuery.length > 0;

  if (!booted) {
    return <BootScreen />;
  }

  if (!session) {
    return <EntryScreen onSave={saveSession} />;
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <p className="eyebrow">{clinic.name}</p>
          <h1>Clinic Tasks</h1>
        </div>
        <div className="topActions">
          <SessionNameTag session={session} onSave={updateSessionName} />
          <span className={`rolePill role-${session.role}`}>
            {roleLabel(session.role)}
          </span>
          <button className="iconButton" onClick={logout} title="Change role">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <section className="commandStrip">
        <button className="primaryButton" onClick={openCreate}>
          <Plus size={18} />
          {session.role === "staff" ? "Add Task" : "New Task"}
        </button>
        <span className={`liveDot ${syncPaused ? "idleDot" : ""}`}>
          {loading ? "syncing" : syncPaused ? "idle" : "live"}
        </span>
        {canSeeEscalations(session.role) ? (
          <span className="escalationSignal">
            <BellRing size={15} />
            {tasks.filter((task) => task.escalatedAt && task.status !== "completed" && task.status !== "archived").length} escalated
          </span>
        ) : null}
        {canSeeEscalations(session.role) && openMediumHighCount > 0 ? (
          <span className="prioritySignal">
            <AlertTriangle size={15} />
            {openMediumHighCount} medium/high open
          </span>
        ) : null}
        {session.role === "admin" || session.role === "veterinarian" ? (
          <NotificationSettingsMenu
            open={settingsOpen}
            saving={settingsSaving}
            endOfDayAlertsEnabled={endOfDayAlertsEnabled}
            recipientProfiles={recipientProfiles}
            canEditAllProfiles={canEditAllProfiles}
            currentProfileId={currentProfileId}
            addingProfile={addingProfile}
            onToggleOpen={toggleSettingsOpen}
            onToggleEndOfDayAlerts={toggleEndOfDayAlerts}
            onSaveProfile={saveRecipientProfile}
            onDeactivateProfile={deactivateRecipientProfile}
            onAddProfile={startAddingProfile}
          />
        ) : null}
      </section>

      <section className="taskSearchBar" aria-label="Task board search">
        <label className="taskSearchField" htmlFor="task-board-search">
          <span>Search tasks</span>
          <input
            id="task-board-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && searchQuery) {
                event.preventDefault();
                setSearchQuery("");
              }
            }}
            placeholder="Search task text, pet, or client"
            aria-describedby="task-board-search-summary"
            data-agent-proof="task-board-search"
          />
        </label>
        <div
          className="taskSearchSummary"
          id="task-board-search-summary"
          data-agent-proof="task-board-search-summary"
        >
          {hasSearchResults ? (
            <p>
              Showing {visibleTasks.length} of {activeTasks.length} tasks for &quot;{normalizedSearchQuery}&quot;
            </p>
          ) : (
            <p>Showing all {activeTasks.length} tasks</p>
          )}
        </div>
      </section>

      {error ? <div className="alertLine">{error}</div> : null}

      <ArrivalDeskPanel
        session={session}
        actorQuery={actorQuery}
        onError={setError}
      />

      {session.role === "admin" ? (
        <ClientJourneyStaffPanel
          session={session}
          actorQuery={actorQuery}
          onError={setError}
        />
      ) : null}

      <TaskLaneGrid
        tasks={visibleTasks}
        role={session.role}
        loading={loading}
        hasLoaded={hasLoaded}
        onEdit={openEdit}
        onStatus={updateStatus}
        onInvalid={(item) => {
          setInvalidTask(item);
          setInvalidReason(item.invalidReason ?? "");
        }}
        onArchive={archiveAction}
        onEscalate={escalate}
        onUndo={undo}
      />

      {canManage(session.role) ? (
        <TaskActivityPanel
          events={events}
          archivedTasks={archivedTasks}
          role={session.role}
          onRestore={(task) => void archiveAction(task, "restore")}
        />
      ) : null}

      {formOpen ? (
        <TaskForm
          form={form}
          setForm={setForm}
          editing={editing}
          role={session.role}
          saving={formSaving}
          onClose={closeForm}
          onSubmit={(event) => {
            event.preventDefault();
            void submitForm();
          }}
        />
      ) : null}

      {invalidTask ? (
        <InvalidTaskModal
          reason={invalidReason}
          onReasonChange={setInvalidReason}
          onCancel={clearInvalidTask}
          onConfirm={(reason) => void updateStatus(invalidTask, "invalid", reason)}
        />
      ) : null}

      {toast ? (
        <TaskBoardToastBanner
          toast={toast}
          onUndo={(taskId) => void undo(taskId)}
          onDismiss={() => setToast(null)}
        />
      ) : null}
      {confetti ? <MiniConfetti /> : null}
    </main>
  );
}
