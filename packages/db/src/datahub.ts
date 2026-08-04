import { getSql } from "./connection";

export type DatahubReceipt = {
  type: string;
  id: string;
  success: boolean;
  error: string;
};

export type DatahubJsonValue =
  | null
  | string
  | number
  | boolean
  | DatahubJsonValue[]
  | { [key: string]: DatahubJsonValue | undefined };

export type DatahubJsonObject = { [key: string]: DatahubJsonValue | undefined };

export type DatahubPimsRecord = {
  entityType: string;
  receiptType: string;
  integrationId: string;
  providerPracticeId: string | null;
  pimsId: string | null;
  siteId: string | null;
  isActive: boolean | null;
  isDeleted: boolean;
  deletedAt: string | null;
  providerUpdatedAt: string | null;
  payload: DatahubJsonObject;
};

export type DatahubEntityGroup = {
  entityKey: string;
  records: DatahubPimsRecord[];
};

export type DatahubWebhookInput = {
  practiceIds: string[];
  timestamp: string;
  version: string;
  groups: DatahubEntityGroup[];
  invalidReceipts?: DatahubReceipt[];
};

type ConnectionRow = {
  clinic_id: string;
  provider_practice_id: string;
};

export class UnmappedDatahubPracticeError extends Error {
  constructor() {
    super("Datahub practice mapping is incomplete.");
    this.name = "UnmappedDatahubPracticeError";
  }
}

export class CrossTenantDatahubBatchError extends Error {
  constructor() {
    super("Datahub batch spans more than one hospital tenant.");
    this.name = "CrossTenantDatahubBatchError";
  }
}

function failedReceipt(record: DatahubPimsRecord, error: string): DatahubReceipt {
  return {
    type: record.receiptType,
    id: record.integrationId,
    success: false,
    error
  };
}

function successfulReceipt(record: DatahubPimsRecord): DatahubReceipt {
  return {
    type: record.receiptType,
    id: record.integrationId,
    success: true,
    error: ""
  };
}

export function deduplicateDatahubRecords(records: DatahubPimsRecord[]) {
  const recordsByIdentity = new Map<string, DatahubPimsRecord>();
  for (const record of records) {
    const identity = JSON.stringify([
      record.providerPracticeId,
      record.entityType,
      record.integrationId
    ]);
    recordsByIdentity.set(identity, record);
  }
  return [...recordsByIdentity.values()];
}

async function resolveBatchClinic(practiceIds: string[]) {
  const sql = getSql();
  const connections = await sql<ConnectionRow[]>`
    select clinic_id, provider_practice_id
    from pims_connections
    where provider = 'datahub'
      and status in ('pending', 'active')
      and provider_practice_id in ${sql(practiceIds)}
  `;
  const mappedPracticeIds = new Set(connections.map((row) => row.provider_practice_id));
  if (practiceIds.some((practiceId) => !mappedPracticeIds.has(practiceId))) {
    throw new UnmappedDatahubPracticeError();
  }
  const clinicIds = new Set(connections.map((row) => row.clinic_id));
  if (clinicIds.size !== 1) throw new CrossTenantDatahubBatchError();
  return [...clinicIds][0];
}

export async function ingestDatahubWebhook(input: DatahubWebhookInput) {
  const sql = getSql();
  const clinicId = await resolveBatchClinic(input.practiceIds);
  const recordCount = input.groups.reduce((total, group) => total + group.records.length, 0)
    + (input.invalidReceipts?.length ?? 0);
  const deliveryRows = await sql<{ id: string }[]>`
    insert into pims_webhook_deliveries (
      clinic_id,
      provider,
      provider_practice_ids,
      provider_timestamp,
      provider_version,
      record_count
    )
    values (
      ${clinicId},
      'datahub',
      ${input.practiceIds},
      ${input.timestamp},
      ${input.version},
      ${recordCount}
    )
    returning id
  `;
  const deliveryId = deliveryRows[0].id;
  const receipts: DatahubReceipt[] = [...(input.invalidReceipts ?? [])];
  const failedGroups: string[] = [];

  for (const group of input.groups) {
    const records = group.records;
    if (records.length === 0) continue;
    const invalidPracticeRecords = records.filter(
      (record) => !record.providerPracticeId || !input.practiceIds.includes(record.providerPracticeId)
    );
    const validRecords = records.filter(
      (record) => record.providerPracticeId && input.practiceIds.includes(record.providerPracticeId)
    );
    receipts.push(...invalidPracticeRecords.map((record) =>
      failedReceipt(record, "Record practiceId does not match webhook metadata.")));
    if (validRecords.length === 0) continue;

    const rows = deduplicateDatahubRecords(validRecords).map((record) => ({
      clinic_id: clinicId,
      provider: "datahub",
      provider_practice_id: record.providerPracticeId,
      entity_type: record.entityType,
      integration_id: record.integrationId,
      pims_id: record.pimsId,
      site_id: record.siteId,
      is_active: record.isActive,
      is_deleted: record.isDeleted,
      deleted_at: record.deletedAt,
      provider_updated_at: record.providerUpdatedAt,
      payload: sql.json(record.payload)
    }));

    try {
      await sql.begin(async (transaction) => {
        await transaction`
          insert into pims_records ${transaction(
            rows,
            "clinic_id",
            "provider",
            "provider_practice_id",
            "entity_type",
            "integration_id",
            "pims_id",
            "site_id",
            "is_active",
            "is_deleted",
            "deleted_at",
            "provider_updated_at",
            "payload"
          )}
          on conflict (
            clinic_id,
            provider,
            provider_practice_id,
            entity_type,
            integration_id
          ) do update set
            pims_id = excluded.pims_id,
            site_id = excluded.site_id,
            is_active = excluded.is_active,
            is_deleted = excluded.is_deleted,
            deleted_at = excluded.deleted_at,
            provider_updated_at = excluded.provider_updated_at,
            payload = excluded.payload,
            last_received_at = now()
        `;
      });
      receipts.push(...validRecords.map(successfulReceipt));
    } catch {
      failedGroups.push(group.entityKey);
      receipts.push(...validRecords.map((record) =>
        failedReceipt(record, "Storage failed for this entity type.")));
    }
  }

  const successfulRecordCount = receipts.filter((receipt) => receipt.success).length;
  const failedRecordCount = receipts.length - successfulRecordCount;
  const status = failedRecordCount === 0
    ? "processed"
    : successfulRecordCount === 0
      ? "failed"
      : "partial";
  await sql`
    update pims_webhook_deliveries
    set successful_record_count = ${successfulRecordCount},
      failed_record_count = ${failedRecordCount},
      status = ${status},
      failure_summary = ${failedGroups.length > 0
        ? `Storage failed for: ${failedGroups.join(", ")}`
        : failedRecordCount > 0
          ? "One or more records failed validation."
          : null},
      processed_at = now()
    where id = ${deliveryId}
      and clinic_id = ${clinicId}
  `;
  await sql`
    update pims_connections
    set status = 'active',
      last_webhook_at = now(),
      updated_at = now()
    where clinic_id = ${clinicId}
      and provider = 'datahub'
      and provider_practice_id in ${sql(input.practiceIds)}
  `;
  return {
    clinicId,
    deliveryId,
    receipts
  };
}
