import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateRenderHealth,
  findRenderDeploy,
  parseRenderLogStream,
  selectRenderService,
  summarizeRenderLogs,
  verifyRenderDeployment
} from "./agent-render-proof.mjs";

const sha = "a".repeat(40);
const latestSha = "b".repeat(40);
const previousSha = "c".repeat(40);
const config = {
  repo: {
    defaultBranch: "main"
  },
  render: {
    serviceName: "vetagent-internal",
    serviceUrl: "https://vetagent-internal.onrender.com",
    deployTimeoutSeconds: 10,
    pollSeconds: 1,
    healthTimeoutSeconds: 1,
    healthChecks: [
      {
        url: "https://centralvet.eepish.com/api/clinic",
        expectedStatus: 200,
        expectedClinicSlug: "central-vet",
        expectedHostname: "centralvet.eepish.com"
      }
    ]
  }
};

function renderDependencies(overrides = {}) {
  return {
    now: () => Date.parse("2026-07-25T04:00:00Z"),
    sleep: async () => {},
    runCommand(_command, args) {
      if (args[0] === "services") {
        return {
          stdout: JSON.stringify([
            {
              service: {
                id: "srv-private",
                name: "vetagent-internal",
                type: "web_service",
                branch: "main",
                serviceDetails: {
                  url: "https://vetagent-internal.onrender.com"
                }
              }
            }
          ])
        };
      }
      if (args[0] === "deploys") {
        return {
          stdout: JSON.stringify([
            {
              id: "dep-private",
              status: "live",
              commit: { id: sha },
              createdAt: "2026-07-25T03:55:00Z",
              finishedAt: "2026-07-25T03:57:00Z"
            }
          ])
        };
      }
      if (args[0] === "logs") {
        return {
          stdout: `${JSON.stringify({
            id: "log-private",
            message: "raw message must not survive",
            timestamp: "2026-07-25T03:56:00Z",
            labels: [
              { name: "level", value: "info" },
              { name: "type", value: "app" }
            ]
          })}\n`
        };
      }
      throw new Error(`unexpected Render command: ${args.join(" ")}`);
    },
    async fetch() {
      return {
        status: 200,
        async text() {
          return JSON.stringify({
            clinic: {
              slug: "central-vet",
              hostname: "centralvet.eepish.com"
            }
          });
        }
      };
    },
    ...overrides
  };
}

test("Render parsers handle CLI wrappers without retaining raw logs", () => {
  const service = selectRenderService(
    [
      {
        service: {
          id: "srv-private",
          name: "vetagent-internal",
          type: "web_service"
        }
      }
    ],
    "vetagent-internal"
  );
  assert.equal(service.id, "srv-private");
  assert.equal(
    findRenderDeploy(
      [{ deploy: { status: "live", commit: { id: sha } } }],
      sha
    ).status,
    "live"
  );
  const records = parseRenderLogStream(
    `${JSON.stringify({
      message: "private log body",
      labels: [
        { name: "level", value: "error" },
        { name: "type", value: "app" }
      ]
    })}\n`
  );
  assert.deepEqual(summarizeRenderLogs(records), {
    count: 1,
    levels: { error: 1 },
    types: { app: 1 },
    errorCount: 1
  });
  assert.equal(JSON.stringify(summarizeRenderLogs(records)).includes("private log body"), false);
});

test("Render log parser accepts the CLI's concatenated pretty JSON objects", () => {
  const first = {
    message: "brace text }{ stays inside the JSON string",
    labels: [{ name: "level", value: "info" }]
  };
  const second = {
    message: "second record",
    labels: [{ name: "type", value: "request" }]
  };
  const output = `${JSON.stringify(first, null, 2)}${JSON.stringify(second, null, 2)}`;

  assert.deepEqual(parseRenderLogStream(output), [first, second]);
  assert.deepEqual(parseRenderLogStream(JSON.stringify([first, second])), [first, second]);
});

test("trusted Render proof binds exact commit, logs, and tenant health", async () => {
  const result = await verifyRenderDeployment(
    { config, expectedSha: sha },
    renderDependencies()
  );

  assert.equal(result.status, "passed");
  assert.equal(result.deployedSha, sha);
  assert.equal(result.logs.count, 1);
  assert.equal(result.health[0].clinicSlug, "central-vet");
  assert.equal(JSON.stringify(result).includes("srv-private"), false);
  assert.equal(JSON.stringify(result).includes("raw message must not survive"), false);
});

test("trusted Render proof requests and pins the latest configured branch", async () => {
  const base = renderDependencies();
  const commands = [];
  let created = false;
  const result = await verifyRenderDeployment(
    { config, expectedSha: sha, ensureLatestDeploy: true },
    {
      ...base,
      runCommand(command, args) {
        commands.push(args);
        if (args[0] === "services" || args[0] === "logs") {
          return base.runCommand(command, args);
        }
        if (args[0] === "deploys" && args[1] === "create") {
          created = true;
          return {
            stdout: JSON.stringify({
              id: "dep-latest",
              status: "created"
            })
          };
        }
        if (args[0] === "deploys" && args[1] === "list") {
          return {
            stdout: JSON.stringify(
              created
                ? [
                    {
                      id: "dep-latest",
                      status: "live",
                      commit: { id: latestSha },
                      createdAt: "2026-07-25T03:55:00Z",
                      finishedAt: "2026-07-25T03:57:00Z"
                    }
                  ]
                : [
                    {
                      id: "dep-previous",
                      status: "live",
                      commit: { id: previousSha }
                    }
                  ]
            )
          };
        }
        throw new Error(`unexpected Render command: ${args.join(" ")}`);
      }
    }
  );

  assert.equal(result.expectedSha, sha);
  assert.equal(result.deployedSha, latestSha);
  assert.equal(result.previousLiveSha, previousSha);
  assert.equal(result.deploymentSource, "latest-branch");
  assert.equal(
    commands.filter((args) => args[0] === "deploys" && args[1] === "create")
      .length,
    1
  );
  assert.equal(commands.some((args) => args.includes("--commit")), false);
});

test("trusted Render proof does not retry a latest-branch deploy mutation", async () => {
  const base = renderDependencies();
  let createAttempts = 0;
  await assert.rejects(
    verifyRenderDeployment(
      {
        config,
        expectedSha: sha,
        ensureLatestDeploy: true,
        timeoutSeconds: 0
      },
      {
        ...base,
        renderRetryDelaysMs: [0, 0, 0],
        runCommand(command, args) {
          if (args[0] === "services") return base.runCommand(command, args);
          if (args[0] === "deploys" && args[1] === "list") {
            return { stdout: "[]" };
          }
          if (args[0] === "deploys" && args[1] === "create") {
            createAttempts += 1;
            assert.equal(args.includes("--commit"), false);
            throw new Error("latest-branch deploy mutation failed");
          }
          throw new Error(`unexpected Render command: ${args.join(" ")}`);
        }
      }
    ),
    /latest-branch deploy mutation failed/
  );
  assert.equal(createAttempts, 1);
});

test("trusted Render proof probes health before requiring runtime logs", async () => {
  const base = renderDependencies();
  let healthProbed = false;
  const result = await verifyRenderDeployment(
    { config, expectedSha: sha },
    {
      ...base,
      runCommand(command, args) {
        if (args[0] === "logs") {
          assert.equal(healthProbed, true);
        }
        return base.runCommand(command, args);
      },
      async fetch(...args) {
        healthProbed = true;
        return base.fetch(...args);
      }
    }
  );

  assert.equal(result.status, "passed");
  assert.equal(healthProbed, true);
});

test("trusted Render proof retries transient read-only CLI failures", async () => {
  const base = renderDependencies();
  let serviceAttempts = 0;
  const result = await verifyRenderDeployment(
    { config, expectedSha: sha },
    {
      ...base,
      renderRetryDelaysMs: [0, 0, 0],
      runCommand(command, args) {
        if (args[0] === "services" && serviceAttempts++ === 0) {
          throw new Error("transient Render API failure");
        }
        return base.runCommand(command, args);
      }
    }
  );

  assert.equal(result.status, "passed");
  assert.equal(serviceAttempts, 2);
});

test("tenant health fails when the public hostname resolves another clinic", () => {
  const check = config.render.healthChecks[0];
  const result = evaluateRenderHealth(
    check,
    { status: 200 },
    {
      clinic: {
        slug: "tri-city-vet",
        hostname: "tricityvet.eepish.com"
      }
    },
    50
  );
  assert.equal(result.passed, false);
});

test("failed exact deployment never falls through to a newer live deployment", async () => {
  await assert.rejects(
    verifyRenderDeployment(
      { config, expectedSha: sha },
      renderDependencies({
        runCommand(_command, args) {
          if (args[0] === "services") {
            return renderDependencies().runCommand(_command, args);
          }
          if (args[0] === "deploys") {
            return {
              stdout: JSON.stringify([
                {
                  status: "build_failed",
                  commit: { id: sha },
                  createdAt: "2026-07-25T03:55:00Z",
                  finishedAt: "2026-07-25T03:57:00Z"
                },
                {
                  status: "live",
                  commit: { id: "b".repeat(40) },
                  createdAt: "2026-07-25T03:50:00Z",
                  finishedAt: "2026-07-25T03:52:00Z"
                }
              ])
            };
          }
          throw new Error("logs must not run after failed deploy");
        }
      })
    ),
    /reached build_failed/
  );
});
