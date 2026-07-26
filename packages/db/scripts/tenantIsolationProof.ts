import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createTask,
  getSql,
  getTask,
  listTasks,
  type Task
} from "../src/index";

type IsolationResult = {
  sourceClinicId: string;
  otherClinicId: string;
  writtenTask: Task;
  sameTenantTask: Task | null;
  otherTenantTask: Task | null;
  sameTenantTasks: Task[];
  otherTenantTasks: Task[];
};

export function assertTenantIsolation(result: IsolationResult) {
  assert.equal(result.writtenTask.clinicId, result.sourceClinicId);
  assert.equal(result.sameTenantTask?.id, result.writtenTask.id);
  assert.equal(result.otherTenantTask, null);
  assert.ok(
    result.sameTenantTasks.some((task) => task.id === result.writtenTask.id)
  );
  assert.ok(
    result.otherTenantTasks.every((task) => task.id !== result.writtenTask.id)
  );
}

async function main() {
  assert.equal(
    process.env.AGENT_DISPOSABLE_DATABASE,
    "1",
    "tenant isolation proof requires an explicitly disposable database"
  );

  const sql = getSql();
  let taskId = "";
  let sourceClinicId = "";
  try {
    const migrationFiles = (
      await readdir(
        fileURLToPath(new URL("../../../db/migrations/", import.meta.url))
      )
    ).filter((file) => file.endsWith(".sql"));
    const [migrationState] = await sql<{ applied: number }[]>`
      select count(*)::int as applied
      from app_schema_migrations
    `;
    assert.equal(
      migrationState?.applied,
      migrationFiles.length,
      "disposable database does not contain every repository migration"
    );

    const clinics = await sql<{ id: string; slug: string }[]>`
      select id, slug
      from clinics
      where slug in ('central-vet', 'tri-city-vet')
    `;
    const clinicBySlug = new Map(
      clinics.map((clinic) => [clinic.slug, clinic.id])
    );
    sourceClinicId = clinicBySlug.get("central-vet") ?? "";
    const otherClinicId = clinicBySlug.get("tri-city-vet") ?? "";
    assert.ok(sourceClinicId, "central-vet clinic is missing");
    assert.ok(otherClinicId, "tri-city-vet clinic is missing");
    assert.notEqual(sourceClinicId, otherClinicId);

    const writtenTask = await createTask(
      {
        clinicId: sourceClinicId,
        idempotencyKey: "agent-disposable-tenant-isolation-proof",
        status: "due",
        source: "admin",
        request: "Verify disposable tenant isolation",
        requestType: "records_request",
        priority: "low",
        dueDate: "2030-01-01"
      },
      { name: "Agent service proof", role: "admin" }
    );
    taskId = writtenTask.id;

    const [
      sameTenantTask,
      otherTenantTask,
      sameTenantTasks,
      otherTenantTasks
    ] = await Promise.all([
      getTask(taskId, { clinicId: sourceClinicId }),
      getTask(taskId, { clinicId: otherClinicId }),
      listTasks({
        clinicId: sourceClinicId,
        role: "admin",
        includeArchived: true
      }),
      listTasks({
        clinicId: otherClinicId,
        role: "admin",
        includeArchived: true
      })
    ]);
    assertTenantIsolation({
      sourceClinicId,
      otherClinicId,
      writtenTask,
      sameTenantTask,
      otherTenantTask,
      sameTenantTasks,
      otherTenantTasks
    });

    console.log(
      JSON.stringify({
        status: "passed",
        migrations: migrationFiles.length,
        tenantScopedWrite: true,
        crossTenantReadBlocked: true
      })
    );
  } finally {
    if (taskId && sourceClinicId) {
      await sql`
        delete from tasks
        where id = ${taskId}
          and clinic_id = ${sourceClinicId}
      `;
    }
    await sql.end();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
