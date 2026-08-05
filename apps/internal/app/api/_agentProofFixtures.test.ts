import assert from "node:assert/strict";
import test from "node:test";
import {
  agentProofActor,
  agentProofArrivalDesk,
  agentProofClinic,
  agentProofFixturesEnabled,
  agentProofTasks
} from "./_agentProofFixtures";

function request(
  host: string,
  {
    method = "GET",
    path = "/api/tasks",
    referrer = "/staff/tasks"
  }: { method?: string; path?: string; referrer?: string } = {}
) {
  return new Request(`http://${host}${path}`, {
    method,
    headers: {
      host,
      referer: `http://127.0.0.1:3000${referrer}`
    }
  });
}

const loopbackServer = ["next", "start", "--hostname", "127.0.0.1"];

test("proof fixtures require the exact task-board scope and loopback process", () => {
  assert.equal(
    agentProofFixturesEnabled(request("127.0.0.1:3000"), {
      AGENT_PROOF_FIXTURES: "task-board"
    }, loopbackServer),
    true
  );
  assert.equal(
    agentProofFixturesEnabled(request("localhost:3000"), {
      AGENT_PROOF_FIXTURES: "task-board"
    }, loopbackServer),
    true
  );
  assert.equal(
    agentProofFixturesEnabled(request("centralvet.example"), {
      AGENT_PROOF_FIXTURES: "task-board"
    }, loopbackServer),
    false
  );
  assert.equal(
    agentProofFixturesEnabled(request("127.0.0.1:3000"), {
      AGENT_PROOF_FIXTURES: "true"
    }, loopbackServer),
    false
  );
  assert.equal(
    agentProofFixturesEnabled(request("127.0.0.1:3000"), {
      AGENT_PROOF_FIXTURES: "task-board"
    }, ["next", "start", "--hostname", "0.0.0.0"]),
    false
  );
  assert.equal(
    agentProofFixturesEnabled(request("127.0.0.1:3000"), {
      AGENT_PROOF_FIXTURES: "task-board"
    }, ["next", "start"]),
    false
  );
});

test("proof fixtures require a task-board referrer and approved API operation", () => {
  const env = { AGENT_PROOF_FIXTURES: "task-board" };

  assert.equal(
    agentProofFixturesEnabled(
      request("127.0.0.1:3000", { referrer: "/request" }),
      env,
      loopbackServer
    ),
    false
  );
  assert.equal(
    agentProofFixturesEnabled(
      request("127.0.0.1:3000", { method: "PATCH", path: "/api/settings" }),
      env,
      loopbackServer
    ),
    false
  );
  assert.equal(
    agentProofFixturesEnabled(
      request("127.0.0.1:3000", { path: "/api/settings" }),
      env,
      loopbackServer
    ),
    true
  );
});

test("proof fixtures provide distinct rendered tasks and bounded demo actors", () => {
  const tasks = agentProofTasks(agentProofClinic());

  assert.deepEqual(tasks.map((task) => task.petName), ["Biscuit", "Mochi"]);
  assert.deepEqual(tasks.map((task) => task.status), ["due", "pending"]);
  assert.deepEqual(agentProofArrivalDesk().arrivals, []);
  assert.deepEqual(agentProofActor({ name: "Front Desk", role: "staff" }), {
    name: "Front Desk",
    role: "staff"
  });
  assert.equal(
    agentProofActor({ name: "Clinic Admin", role: "admin", passcode: "wrong" }),
    null
  );
});
