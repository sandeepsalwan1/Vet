type RequestField =
  | "requestType"
  | "clientName"
  | "clientPhone"
  | "clientDateOfBirth"
  | "petName"
  | "petWeight"
  | "request";

export type FieldErrors = Partial<Record<RequestField, string>>;

type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

export type ClientRequestLogger = {
  info?: (event: string, fields?: LogFields) => void;
  warn?: (event: string, fields?: LogFields) => void;
  error?: (event: string, error: unknown, fields?: LogFields) => void;
};

export type ClientRequestResult = {
  body: { ok: true; id: string } | { error: string; fieldErrors?: FieldErrors };
  status: number;
};

export type ClientRequestOptions = {
  clinicId?: string | null;
  hospitalName?: string;
  logger?: ClientRequestLogger;
  maxTrackedClients?: number;
};
