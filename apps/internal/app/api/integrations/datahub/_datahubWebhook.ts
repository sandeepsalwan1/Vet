import { timingSafeEqual } from "node:crypto";
import {
  CrossTenantDatahubBatchError,
  ingestDatahubWebhook,
  UnmappedDatahubPracticeError,
  type DatahubEntityGroup,
  type DatahubJsonObject,
  type DatahubPimsRecord,
  type DatahubReceipt,
  type DatahubWebhookInput
} from "@central-vet/db";
import { NextResponse } from "next/server";
import { noStoreHeaders } from "../../_apiResponse";

const receiptTypes: Record<string, string> = {
  practiceAuthorizations: "PracticeAuthorization",
  species: "Species",
  breeds: "Breed",
  sexes: "Sex",
  appointmentStatuses: "AppointmentStatus",
  appointmentTypes: "AppointmentType",
  currencies: "Currency",
  employees: "Employee",
  timezones: "Timezone",
  resources: "Resource",
  clients: "Client",
  clientPhoneNumbers: "ClientPhoneNumber",
  clientEmails: "ClientEmail",
  patients: "Patient",
  ownerships: "Ownership",
  appointments: "Appointment",
  blockoffs: "Blockoff",
  resourceBlockoffs: "ResourceBlockoff",
  patientReminders: "PatientReminder",
  transactions: "Transaction",
  transactionTypes: "TransactionType",
  transactionStatuses: "TransactionStatus",
  invoices: "Invoice",
  soapNotes: "SoapNote",
  serviceHistories: "ServiceHistory",
  serviceCodes: "ServiceCode",
  serviceTypes: "ServiceType",
  hoursOfOperation: "HoursOfOperation",
  shifts: "Shift",
  resourceShifts: "ResourceShift"
};

export class InvalidDatahubPayloadError extends Error {
  constructor(message = "Invalid Datahub webhook payload.") {
    super(message);
    this.name = "InvalidDatahubPayloadError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown, maxLength = 300) {
  return typeof value === "string" && value.trim() && value.length <= maxLength
    ? value.trim()
    : null;
}

function dateValue(value: unknown) {
  const text = stringValue(value, 100);
  return text && Number.isFinite(Date.parse(text)) ? text : null;
}

function receiptType(entityKey: string, record?: Record<string, unknown>) {
  return stringValue(record?.type, 100)
    ?? receiptTypes[entityKey]
    ?? `${entityKey.at(0)?.toUpperCase() ?? ""}${entityKey.slice(1)}`;
}

function invalidReceipt(entityKey: string, index: number, error: string): DatahubReceipt {
  return {
    type: receiptType(entityKey),
    id: `${entityKey}:${index}`,
    success: false,
    error
  };
}

function parseRecord(
  entityKey: string,
  value: unknown,
  index: number,
  practiceIds: string[]
): DatahubPimsRecord | DatahubReceipt {
  if (!isObject(value)) {
    return invalidReceipt(entityKey, index, "Entity must be a JSON object.");
  }
  const deprecatedId = value.type === "Deprecated" ? `deprecated:${entityKey}` : null;
  const integrationId = stringValue(value.integrationId, 300)
    ?? stringValue(value.id, 300)
    ?? deprecatedId;
  if (!integrationId) {
    return invalidReceipt(entityKey, index, "Entity is missing integrationId and id.");
  }
  const recordPracticeId = stringValue(value.practiceId, 300);
  return {
    entityType: entityKey,
    receiptType: receiptType(entityKey, value),
    integrationId,
    providerPracticeId: recordPracticeId ?? (practiceIds.length === 1 ? practiceIds[0] : null),
    pimsId: stringValue(value.pimsId, 300),
    siteId: stringValue(value.siteId, 300) ?? stringValue(value.siteid, 300),
    isActive: typeof value.isActive === "boolean" ? value.isActive : null,
    isDeleted: typeof value.isDeleted === "boolean" ? value.isDeleted : false,
    deletedAt: dateValue(value.deletedAt),
    providerUpdatedAt: dateValue(value.updatedAt) ?? dateValue(value.pimsUpdatedAt),
    payload: value as DatahubJsonObject
  };
}

export function parseDatahubWebhook(value: unknown): DatahubWebhookInput {
  if (!isObject(value) || !isObject(value.metadata) || !isObject(value.data)) {
    throw new InvalidDatahubPayloadError();
  }
  const practiceIdsValue = value.metadata.practiceIds;
  if (!Array.isArray(practiceIdsValue) || practiceIdsValue.length === 0) {
    throw new InvalidDatahubPayloadError("metadata.practiceIds must be a non-empty array.");
  }
  const practiceIds = [...new Set(practiceIdsValue.map((item) => stringValue(item, 300)))];
  if (practiceIds.some((item) => item === null)) {
    throw new InvalidDatahubPayloadError("metadata.practiceIds contains an invalid value.");
  }
  const normalizedPracticeIds = practiceIds as string[];
  const timestamp = dateValue(value.metadata.timestamp);
  const version = stringValue(value.metadata.version, 50);
  if (!timestamp || !version) {
    throw new InvalidDatahubPayloadError("metadata.timestamp or metadata.version is invalid.");
  }

  const groups: DatahubEntityGroup[] = [];
  const invalidReceipts: DatahubReceipt[] = [];
  for (const [entityKey, recordsValue] of Object.entries(value.data)) {
    if (!/^[a-z][A-Za-z0-9]{0,79}$/.test(entityKey) || !Array.isArray(recordsValue)) {
      throw new InvalidDatahubPayloadError(`data.${entityKey} must be an entity array.`);
    }
    const records: DatahubPimsRecord[] = [];
    recordsValue.forEach((recordValue, index) => {
      const parsed = parseRecord(entityKey, recordValue, index, normalizedPracticeIds);
      if ("success" in parsed) invalidReceipts.push(parsed);
      else records.push(parsed);
    });
    groups.push({ entityKey, records });
  }
  return {
    practiceIds: normalizedPracticeIds,
    timestamp,
    version,
    groups,
    invalidReceipts
  };
}

export function hasValidDatahubWebhookSecret(headers: Headers, expectedSecret: string | undefined) {
  if (!expectedSecret) return false;
  const suppliedSecret = headers.get("x-datahub-webhook-secret")
    ?? headers.get("x-partner-api-key")
    ?? "";
  const supplied = Buffer.from(suppliedSecret);
  const expected = Buffer.from(expectedSecret);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

type DatahubWebhookOptions = {
  expectedSecret?: string;
  ingest?: typeof ingestDatahubWebhook;
};

export async function datahubWebhookResponse(
  request: Request,
  options: DatahubWebhookOptions = {}
) {
  const expectedSecret = options.expectedSecret ?? process.env.DATAHUB_WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json(
      { error: "Datahub webhook is not configured." },
      { status: 503, headers: noStoreHeaders }
    );
  }
  if (!hasValidDatahubWebhookSecret(request.headers, expectedSecret)) {
    return NextResponse.json(
      { error: "Unauthorized." },
      { status: 401, headers: noStoreHeaders }
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415, headers: noStoreHeaders }
    );
  }

  let input: DatahubWebhookInput;
  try {
    input = parseDatahubWebhook(await request.json());
  } catch (error) {
    if (error instanceof InvalidDatahubPayloadError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "Invalid Datahub webhook payload." },
        { status: 400, headers: noStoreHeaders }
      );
    }
    throw error;
  }

  try {
    const result = await (options.ingest ?? ingestDatahubWebhook)(input);
    return NextResponse.json(result.receipts, { status: 200, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof UnmappedDatahubPracticeError
      || error instanceof CrossTenantDatahubBatchError) {
      return NextResponse.json(
        { error: "Datahub practice mapping is not ready." },
        { status: 503, headers: noStoreHeaders }
      );
    }
    throw error;
  }
}
