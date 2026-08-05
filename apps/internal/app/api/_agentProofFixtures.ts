import type {
  Actor,
  ArrivalDeskSnapshot,
  ClinicContext,
  CreateTaskInput,
  Task,
  TaskStatus,
  UpdateTaskInput
} from "@central-vet/db";
import { isLocalProofHost } from "../proof/_proofHost";
import { requestHostname } from "./_requestHostname";

const proofFixtureFlag = "task-board";
const proofStateKey = "__centralVetAgentProofTaskStateV1";
const proofTimestamp = Date.parse("2026-01-15T16:00:00.000Z");

type AgentProofTaskState = {
  clinicId: string;
  history: Map<string, Task[]>;
  nextId: number;
  tasks: Task[];
  tick: number;
};

type AgentProofGlobal = typeof globalThis & {
  [proofStateKey]?: AgentProofTaskState;
};

function serverHostnameArgument(argv: string[]) {
  for (const [index, argument] of argv.entries()) {
    if (argument === "--hostname" || argument === "-H") {
      return argv[index + 1] ?? "";
    }
    if (argument.startsWith("--hostname=")) {
      return argument.slice("--hostname=".length);
    }
  }
  return "";
}

function taskBoardReferrer(request: Request) {
  const value = request.headers.get("referer");
  if (!value) return false;
  try {
    const referrer = new URL(value);
    return isLocalProofHost(referrer.host) &&
      (referrer.pathname === "/staff" || referrer.pathname === "/staff/tasks");
  } catch {
    return false;
  }
}

function fixtureEndpoint(request: Request) {
  const { pathname } = new URL(request.url);
  if (request.method === "GET") {
    return [
      "/api/arrival-intake",
      "/api/clinic",
      "/api/events",
      "/api/settings",
      "/api/tasks"
    ].includes(pathname);
  }
  if (request.method === "POST") {
    return pathname === "/api/auth" ||
      pathname === "/api/tasks" ||
      /^\/api\/tasks\/[^/]+\/undo$/.test(pathname);
  }
  return request.method === "PATCH" && /^\/api\/tasks\/[^/]+$/.test(pathname);
}

export function agentProofFixturesEnabled(
  request: Request,
  env: Record<string, string | undefined> = process.env,
  argv: string[] = process.argv
) {
  return env.AGENT_PROOF_FIXTURES === proofFixtureFlag &&
    isLocalProofHost(serverHostnameArgument(argv)) &&
    isLocalProofHost(requestHostname(request)) &&
    taskBoardReferrer(request) &&
    fixtureEndpoint(request);
}

export function agentProofClinic(): ClinicContext {
  return {
    clinicId: "clinic-agent-proof",
    slug: "agent-proof",
    name: "Central Veterinary Hospital",
    timeZone: "America/Los_Angeles",
    hostname: null
  };
}

export function agentProofActor(
  actor: { name?: string; role: Actor["role"]; passcode?: string }
): Actor | null {
  const name = actor.name?.trim() || "";
  if (!name) return null;
  if (actor.role === "staff") return { name, role: "staff" };
  if (
    ["va", "task_adder", "admin"].includes(actor.role) &&
    actor.passcode === "246810"
  ) {
    return {
      name,
      role: actor.role === "admin" ? "admin" : "va"
    };
  }
  if (actor.role === "veterinarian" && actor.passcode === "135790") {
    return { name, role: "veterinarian" };
  }
  return null;
}

function task(
  clinic: ClinicContext,
  values: Pick<Task, "id" | "status" | "petName" | "clientName" | "request" | "requestType" | "priority" | "dueTime">
): Task {
  return {
    ...values,
    clinicId: clinic.clinicId,
    hospitalName: clinic.name,
    source: "admin",
    clarityId: null,
    clientPhone: "(415) 555-0100",
    clientDateOfBirth: null,
    petWeight: null,
    lastVisit: null,
    notes: null,
    assignedTo: null,
    assignedByRole: null,
    dueDate: "2099-01-15",
    createdByName: "Clinic Admin",
    createdByRole: "admin",
    updatedByName: null,
    completedByName: null,
    completedByRole: null,
    completedAt: null,
    invalidReason: null,
    archivedAt: null,
    archivedByName: null,
    archivedByRole: null,
    escalatedAt: null,
    escalatedByName: null,
    escalatedByRole: null,
    createdAt: "2026-01-15T16:00:00.000Z",
    updatedAt: "2026-01-15T16:00:00.000Z"
  };
}

function initialTasks(clinic: ClinicContext): Task[] {
  return [
    task(clinic, {
      id: "task-agent-proof-biscuit",
      status: "due",
      petName: "Biscuit",
      clientName: "Maya Parker",
      request: "Review Biscuit's lab results with the client",
      requestType: "labs_xrays",
      priority: "medium",
      dueTime: "09:00"
    }),
    task(clinic, {
      id: "task-agent-proof-mochi",
      status: "pending",
      petName: "Mochi",
      clientName: "Jordan Lee",
      request: "Confirm Mochi's vaccination appointment",
      requestType: "scheduling",
      priority: "low",
      dueTime: "10:30"
    })
  ];
}

function taskState(clinic: ClinicContext) {
  const proofGlobal = globalThis as AgentProofGlobal;
  if (!proofGlobal[proofStateKey] || proofGlobal[proofStateKey]?.clinicId !== clinic.clinicId) {
    proofGlobal[proofStateKey] = {
      clinicId: clinic.clinicId,
      history: new Map(),
      nextId: 1,
      tasks: initialTasks(clinic),
      tick: 0
    };
  }
  return proofGlobal[proofStateKey];
}

function nextTimestamp(state: AgentProofTaskState) {
  state.tick += 1;
  return new Date(proofTimestamp + state.tick * 1_000).toISOString();
}

function findTask(state: AgentProofTaskState, id: string) {
  return state.tasks.find((candidate) => candidate.id === id) ?? null;
}

function replaceTask(state: AgentProofTaskState, next: Task) {
  const index = state.tasks.findIndex((candidate) => candidate.id === next.id);
  if (index === -1) return null;
  state.tasks[index] = next;
  return { ...next };
}

function rememberStatus(state: AgentProofTaskState, current: Task) {
  const history = state.history.get(current.id) ?? [];
  history.push({ ...current });
  state.history.set(current.id, history);
}

function cleanText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function taskTime(value: unknown) {
  const match = cleanText(value)?.match(/^([01]\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/);
  return match ? `${match[1]}:${match[2]}` : "19:00";
}

export function resetAgentProofTaskState() {
  delete (globalThis as AgentProofGlobal)[proofStateKey];
}

export function agentProofTasks(
  clinic: ClinicContext,
  {
    includeArchived = false,
    role
  }: {
    includeArchived?: boolean;
    role?: Actor["role"];
  } = {}
): Task[] {
  const manager = role === "va" ||
    role === "task_adder" ||
    role === "veterinarian" ||
    role === "admin";
  const showArchived = includeArchived && manager;
  return taskState(clinic).tasks
    .filter((candidate) => {
      if (showArchived) return true;
      if (candidate.status === "archived") return false;
      return role !== "staff" ||
        (candidate.status !== "pending_review" && candidate.status !== "invalid");
    })
    .map((candidate) => ({ ...candidate }));
}

export function agentProofGetTask(clinic: ClinicContext, id: string) {
  const current = findTask(taskState(clinic), id);
  return current ? { ...current } : null;
}

export function agentProofCreateTask(
  clinic: ClinicContext,
  input: CreateTaskInput,
  actor: Actor
) {
  const state = taskState(clinic);
  const timestamp = nextTimestamp(state);
  const created = task(clinic, {
    id: `task-agent-proof-created-${state.nextId++}`,
    status: input.status,
    petName: cleanText(input.petName),
    clientName: cleanText(input.clientName),
    request: input.request.trim(),
    requestType: input.requestType ?? "labs_xrays",
    priority: input.priority ?? "medium",
    dueTime: taskTime(input.dueTime)
  });
  const next: Task = {
    ...created,
    source: input.source,
    clarityId: cleanText(input.clarityId),
    clientPhone: cleanText(input.clientPhone),
    clientDateOfBirth: cleanText(input.clientDateOfBirth),
    petWeight: cleanText(input.petWeight),
    lastVisit: cleanText(input.lastVisit),
    notes: cleanText(input.notes),
    assignedTo: cleanText(input.assignedTo),
    assignedByRole: cleanText(input.assignedTo) ? actor.role : null,
    dueDate: cleanText(input.dueDate) ?? "2099-01-15",
    createdByName: actor.name,
    createdByRole: actor.role,
    updatedByName: actor.name,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.tasks.push(next);
  return { ...next };
}

export function agentProofEditTask(
  clinic: ClinicContext,
  id: string,
  input: UpdateTaskInput,
  actor: Actor
) {
  const state = taskState(clinic);
  const current = findTask(state, id);
  if (!current) return null;
  const next = { ...current, updatedByName: actor.name, updatedAt: nextTimestamp(state) };
  const textFields = [
    "clientName",
    "clarityId",
    "clientPhone",
    "clientDateOfBirth",
    "petName",
    "petWeight",
    "lastVisit",
    "notes",
    "assignedTo"
  ] as const;
  for (const field of textFields) {
    if (field in input) {
      (next[field] as string | null) = cleanText(input[field]);
    }
  }
  if (input.request) next.request = input.request.trim();
  if ("requestType" in input) next.requestType = input.requestType ?? "labs_xrays";
  if ("priority" in input) next.priority = input.priority ?? "medium";
  if (input.dueDate) next.dueDate = input.dueDate;
  if ("dueTime" in input) next.dueTime = taskTime(input.dueTime);
  if ("assignedTo" in input) {
    next.assignedByRole = next.assignedTo ? actor.role : null;
  }
  return replaceTask(state, next);
}

export function agentProofTransitionTask(args: {
  clinic: ClinicContext;
  id: string;
  nextStatus: TaskStatus;
  actor: Actor;
  invalidReason?: string | null;
}) {
  const state = taskState(args.clinic);
  const current = findTask(state, args.id);
  if (!current) return null;
  rememberStatus(state, current);
  const timestamp = nextTimestamp(state);
  const next: Task = {
    ...current,
    status: args.nextStatus,
    updatedByName: args.actor.name,
    updatedAt: timestamp
  };
  if (args.nextStatus === "completed") {
    Object.assign(next, {
      assignedTo: null,
      assignedByRole: null,
      completedByName: args.actor.name,
      completedByRole: args.actor.role,
      completedAt: timestamp,
      invalidReason: null,
      archivedAt: null,
      archivedByName: null,
      archivedByRole: null
    });
  } else if (args.nextStatus === "invalid") {
    Object.assign(next, {
      assignedTo: null,
      assignedByRole: null,
      completedByName: null,
      completedByRole: null,
      completedAt: null,
      invalidReason: cleanText(args.invalidReason) ?? "Marked invalid",
      archivedAt: null,
      archivedByName: null,
      archivedByRole: null
    });
  } else if (args.nextStatus === "archived") {
    Object.assign(next, {
      assignedTo: null,
      assignedByRole: null,
      invalidReason: cleanText(args.invalidReason),
      archivedAt: timestamp,
      archivedByName: args.actor.name,
      archivedByRole: args.actor.role
    });
  } else {
    Object.assign(next, {
      assignedTo: args.nextStatus === "pending" ? args.actor.name : null,
      assignedByRole: args.nextStatus === "pending" ? args.actor.role : null,
      completedByName: null,
      completedByRole: null,
      completedAt: null,
      invalidReason: null,
      archivedAt: null,
      archivedByName: null,
      archivedByRole: null
    });
  }
  return replaceTask(state, next);
}

export function agentProofEscalateTask(
  clinic: ClinicContext,
  id: string,
  actor: Actor
) {
  const state = taskState(clinic);
  const current = findTask(state, id);
  if (!current) return null;
  const timestamp = nextTimestamp(state);
  return replaceTask(state, {
    ...current,
    escalatedAt: current.escalatedAt ?? timestamp,
    escalatedByName: current.escalatedByName ?? actor.name,
    escalatedByRole: current.escalatedByRole ?? actor.role,
    updatedByName: actor.name,
    updatedAt: timestamp
  });
}

export function agentProofUndoLastStatusChange(
  clinic: ClinicContext,
  id: string,
  actor: Actor
) {
  const state = taskState(clinic);
  const history = state.history.get(id);
  const previous = history?.pop();
  if (!previous) return null;
  return replaceTask(state, {
    ...previous,
    updatedByName: actor.name,
    updatedAt: nextTimestamp(state)
  });
}

export function agentProofArrivalDesk(): ArrivalDeskSnapshot {
  return {
    settings: {
      roomAssignmentEnabled: true,
      questionnaire: {
        visitReasons: ["Sick", "Vaccines", "Surgery", "Dental", "Routine"],
        sickSignsLabel: "What signs are you seeing?",
        sickSigns: ["Vomiting", "Diarrhea", "Coughing", "Other signs"],
        specialConcernsLabel: "Any special concerns?",
        vaccineFeelingLabel: "How is your pet feeling today?",
        surgeryAteLabel: "Did your pet eat today?",
        surgeryFeelingLabel: "How is your pet feeling today?",
        dentalConcernLabel: "Any dental concerns today?",
        routineConcernLabel: "Scratching, itching, routine vaccines, or anything else?"
      }
    },
    rooms: [],
    arrivals: []
  };
}
