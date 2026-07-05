type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type JsonObject = { [key: string]: JsonValue };

export function jsonInput(value: Record<string, unknown> | Record<string, unknown>[]) {
  return value as never;
}

function redactJson(value: unknown, depth = 0): JsonValue {
  if (depth > 8) return "[max-depth]";
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > 1000 ? `${value.slice(0, 1000)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactJson(item, depth + 1));
  if (typeof value === "object") {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/passcode|api.?key|token|authorization|auth.?header|secret/i.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = redactJson(item, depth + 1);
      }
    }
    return output;
  }
  return String(value);
}

export function redactedAgentObject(value: Record<string, unknown> | undefined) {
  return redactJson(value ?? {}) as Record<string, unknown>;
}
