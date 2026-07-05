class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function errorMessage(data: unknown, fallback: string) {
  const body = record(data);
  for (const key of ["error", "detail", "message"]) {
    const value = body?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return fallback;
}

export async function readJson<T = Record<string, unknown>>(
  response: Response,
  fallback = "Request failed."
): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(errorMessage(data, fallback), response.status, data);
  }
  return data as T;
}

export function isAuthError(error: unknown) {
  return error instanceof ApiError && (error.status === 403 || error.status === 429);
}

export function fieldErrors<T extends string>(error: unknown): Partial<Record<T, string>> {
  if (!(error instanceof ApiError)) return {};
  const body = record(error.data);
  const fields = record(body?.fieldErrors);
  if (!fields) return {};
  const entries = Object.entries(fields).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  return Object.fromEntries(entries) as Partial<Record<T, string>>;
}
