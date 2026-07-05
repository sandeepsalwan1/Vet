import { createTask, MissingDatabaseUrlError, resolveClinicId } from "@central-vet/db";
import {
  clientKey,
  contentHash,
  hashValue,
  persistentGuard,
  rateLimited,
  recordGuard
} from "./clientRequestGuard";
import { loggerFor } from "./clientRequestLogger";
import {
  hasErrors,
  requestSchema,
  validateFields
} from "./clientRequestValidation";
import type {
  ClientRequestOptions,
  ClientRequestResult,
  FieldErrors
} from "./clientRequestTypes";

export async function handleClientRequest(
  request: Request,
  options: ClientRequestOptions = {}
): Promise<ClientRequestResult> {
  const logger = loggerFor(options.logger);
  const clientHash = hashValue(clientKey(request));
  let clinicId = "";
  let requestHash = hashValue("empty");
  const logIds = () => ({
    clientKey: clientHash.slice(0, 12),
    requestKey: requestHash.slice(0, 12)
  });

  try {
    clinicId = await resolveClinicId(options.clinicId);
    const body = await request.json().catch(() => null);
    if (!body) {
      logger.warn("client_request_rejected", { ...logIds(), reason: "invalid_json" });
      return { body: { error: "Please use the request form." }, status: 400 };
    }
    requestHash = contentHash(body);

    if (rateLimited(clientHash, options.maxTrackedClients ?? 2000)) {
      logger.warn("client_request_rejected", { ...logIds(), reason: "memory_rate_limit" });
      return { body: { error: "Too many requests. Please try again later." }, status: 429 };
    }

    const guard = await persistentGuard(clinicId, clientHash, requestHash);
    if (guard.rateLimited || guard.duplicate) {
      await recordGuard(clinicId, clientHash, requestHash, guard.duplicate ? "duplicate" : "rate_limited");
      logger.warn("client_request_rejected", {
        ...logIds(),
        reason: guard.duplicate ? "duplicate" : "persistent_rate_limit"
      });
      return {
        body: {
          error: guard.duplicate
            ? "This request was already submitted."
            : "Too many requests. Please try again later."
        },
        status: 429
      };
    }

    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      await recordGuard(clinicId, clientHash, requestHash, "validation_failed");
      logger.warn("client_request_rejected", { ...logIds(), reason: "invalid_schema" });
      return {
        body: {
          error: "Please fix the highlighted fields.",
          fieldErrors: { request: "Please use the form fields." }
        },
        status: 400
      };
    }

    const fieldErrors: FieldErrors = validateFields(parsed.data);
    if (hasErrors(fieldErrors)) {
      await recordGuard(clinicId, clientHash, requestHash, "validation_failed");
      logger.warn("client_request_rejected", {
        ...logIds(),
        reason: "field_validation",
        fields: Object.keys(fieldErrors).join(",")
      });
      return {
        body: { error: "Please fix the highlighted fields.", fieldErrors },
        status: 400
      };
    }

    const task = await createTask(
      {
        ...parsed.data,
        clinicId,
        hospitalName: options.hospitalName || process.env.HOSPITAL_NAME || "Central Veterinary Hospital",
        source: "client_form",
        status: "pending_review",
        priority: "low",
        requestType: parsed.data.requestType,
        dueDate: new Date().toISOString().slice(0, 10),
        dueTime: "19:00"
      },
      {
        name: parsed.data.clientName,
        role: "staff"
      }
    );

    await recordGuard(clinicId, clientHash, requestHash, "accepted");
    logger.info("client_request_accepted", { ...logIds(), taskId: task.id });
    return { body: { ok: true, id: task.id }, status: 201 };
  } catch (error) {
    if (error instanceof MissingDatabaseUrlError) {
      logger.warn("client_request_failed", { ...logIds(), reason: "database_missing_url" });
      return {
        body: {
          error: "Request system is not connected yet. Please call the hospital directly."
        },
        status: 503
      };
    }
    logger.error("client_request_failed", error, logIds());
    return { body: { error: "Unable to submit request." }, status: 500 };
  }
}
