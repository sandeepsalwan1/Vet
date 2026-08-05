import assert from "node:assert/strict";
import test from "node:test";
import { resetAgentProofTaskState } from "../_agentProofFixtures";
import { taskUpdateResponse } from "./[id]/_taskUpdateRequest";
import { taskUndoResponse } from "./[id]/undo/_taskUndoRequest";
import { taskCreateResponse } from "./_taskCreateRequest";
import { taskListResponse } from "./_taskListRequest";

const priorFixtureFlag = process.env.AGENT_PROOF_FIXTURES;
const priorArgv = [...process.argv];
const baseUrl = "http://127.0.0.1:3000/api/tasks";

function request(
  url = baseUrl,
  { body, method = "GET", passcode }: {
    body?: unknown;
    method?: string;
    passcode?: string;
  } = {}
) {
  const headers = new Headers({
    host: "127.0.0.1:3000",
    referer: "http://127.0.0.1:3000/staff/tasks"
  });
  if (body !== undefined) headers.set("content-type", "application/json");
  if (passcode) headers.set("x-central-vet-passcode", passcode);
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

async function responseJson<T>(response: Response) {
  return await response.json() as T;
}

test.before(() => {
  process.env.AGENT_PROOF_FIXTURES = "task-board";
  process.argv.push("--hostname", "127.0.0.1");
});

test.beforeEach(() => {
  resetAgentProofTaskState();
});

test.after(() => {
  if (priorFixtureFlag === undefined) delete process.env.AGENT_PROOF_FIXTURES;
  else process.env.AGENT_PROOF_FIXTURES = priorFixtureFlag;
  process.argv.splice(0, process.argv.length, ...priorArgv);
  resetAgentProofTaskState();
});

test("proof task endpoints preserve status changes, archive visibility, and undo", async () => {
  const staff = { name: "Front Desk", role: "staff" } as const;
  const admin = {
    name: "Clinic Admin",
    role: "admin",
    passcode: "246810"
  } as const;
  const id = "task-agent-proof-biscuit";

  let response = await taskUpdateResponse({
    id,
    request: request(`${baseUrl}/${id}`, {
      method: "PATCH",
      body: { actor: staff, action: "status", nextStatus: "completed" }
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await responseJson<{ task: { status: string } }>(response)).task.status, "completed");

  response = await taskUndoResponse({
    id,
    request: request(`${baseUrl}/${id}/undo`, {
      method: "POST",
      body: { actor: admin }
    })
  });
  assert.equal(response.status, 200);
  assert.equal((await responseJson<{ task: { status: string } }>(response)).task.status, "due");

  response = await taskUpdateResponse({
    id,
    request: request(`${baseUrl}/${id}`, {
      method: "PATCH",
      body: { actor: admin, action: "archive" }
    })
  });
  assert.equal(response.status, 200);

  const staffList = await responseJson<{ tasks: Array<{ id: string }> }>(
    await taskListResponse(
      request(`${baseUrl}?name=Front%20Desk&role=staff&includeArchived=true`)
    )
  );
  assert.equal(staffList.tasks.some((task) => task.id === id), false);

  const archivedList = await responseJson<{ tasks: Array<{ id: string; status: string }> }>(
    await taskListResponse(
      request(`${baseUrl}?name=Clinic%20Admin&role=admin&includeArchived=true`, {
        passcode: "246810"
      })
    )
  );
  assert.equal(
    archivedList.tasks.find((task) => task.id === id)?.status,
    "archived"
  );
});

test("proof task endpoints support create, edit, and escalation without a database", async () => {
  const staff = { name: "Front Desk", role: "staff" } as const;
  const admin = {
    name: "Clinic Admin",
    role: "admin",
    passcode: "246810"
  } as const;
  let response = await taskCreateResponse(
    request(baseUrl, {
      method: "POST",
      body: {
        actor: admin,
        task: {
          status: "pending_review",
          clientName: "Alex Morgan",
          clientPhone: "4155550123",
          petName: "Pepper",
          request: "Confirm Pepper's medication refill",
          requestType: "prescription",
          priority: "medium",
          dueDate: "2099-01-16",
          dueTime: "11:00"
        }
      }
    })
  );
  assert.equal(response.status, 201);
  const created = (await responseJson<{ task: { id: string; petName: string } }>(response)).task;
  assert.equal(created.petName, "Pepper");

  const staffList = await responseJson<{ tasks: Array<{ id: string }> }>(
    await taskListResponse(request(`${baseUrl}?name=Front%20Desk&role=staff`))
  );
  assert.equal(staffList.tasks.some((task) => task.id === created.id), false);

  const adminList = await responseJson<{ tasks: Array<{ id: string }> }>(
    await taskListResponse(
      request(`${baseUrl}?name=Clinic%20Admin&role=admin`, {
        passcode: "246810"
      })
    )
  );
  assert.equal(adminList.tasks.some((task) => task.id === created.id), true);

  response = await taskUpdateResponse({
    id: created.id,
    request: request(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      body: {
        actor: admin,
        action: "edit",
        task: {
          request: "Confirm Pepper's updated medication refill",
          dueTime: null,
          priority: null
        }
      }
    })
  });
  assert.equal(response.status, 200);
  const edited = (await responseJson<{
    task: { dueTime: string; priority: string; request: string };
  }>(response)).task;
  assert.equal(edited.request, "Confirm Pepper's updated medication refill");
  assert.equal(edited.dueTime, "19:00");
  assert.equal(edited.priority, "medium");

  response = await taskUpdateResponse({
    id: created.id,
    request: request(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      body: { actor: staff, action: "escalate" }
    })
  });
  assert.equal(response.status, 200);
  assert.ok((await responseJson<{ task: { escalatedAt: string | null } }>(response)).task.escalatedAt);
});
