import type { ClientRequestLogger, LogFields } from "./clientRequestTypes";

function logPayload(event: string, fields: LogFields = {}) {
  return {
    event,
    at: new Date().toISOString(),
    ...fields
  };
}

const defaultLogger: Required<ClientRequestLogger> = {
  info: (event, fields) => console.info(logPayload(event, fields)),
  warn: (event, fields) => console.warn(logPayload(event, fields)),
  error: (event, error, fields) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(logPayload(event, { ...fields, error: message }));
  }
};

export function loggerFor(logger?: ClientRequestLogger): Required<ClientRequestLogger> {
  return {
    info: logger?.info ?? defaultLogger.info,
    warn: logger?.warn ?? defaultLogger.warn,
    error: logger?.error ?? defaultLogger.error
  };
}
