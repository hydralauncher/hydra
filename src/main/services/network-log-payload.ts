const REDACTED_VALUE = "[REDACTED]";
const CIRCULAR_VALUE = "[Circular]";

const sensitiveKeys = new Set([
  "accesstoken",
  "authorization",
  "authtoken",
  "cookie",
  "downloadurl",
  "password",
  "proxy-authorization",
  "refreshtoken",
  "set-cookie",
  "signedurl",
  "token",
  "uploadurl",
  "username",
  "workwondersjwt",
  "x-amz-security-token",
]);

const sensitiveQueryKeys = new Set([
  "access_token",
  "credential",
  "signature",
  "sig",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
]);

const normalizedKey = (key: string) => key.toLocaleLowerCase("en-US");

const redactSensitiveUrlParameters = (value: string) => {
  if (!/^https?:\/\//i.test(value)) return value;

  try {
    const parsed = new URL(value);
    const queryKeys = new Set(parsed.searchParams.keys());

    for (const key of queryKeys) {
      if (sensitiveQueryKeys.has(normalizedKey(key))) {
        parsed.searchParams.set(key, REDACTED_VALUE);
      }
    }
    return parsed.toString();
  } catch {
    return value;
  }
};

const parseSerializedPayload = (value: string): unknown => {
  const trimmed = value.trim();
  if (
    !(
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    )
  ) {
    return value;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
};

const sanitizePayload = (value: unknown, seen: WeakSet<object>): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const parsed = parseSerializedPayload(value);
    return parsed === value
      ? redactSensitiveUrlParameters(value)
      : sanitizePayload(parsed, seen);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (seen.has(value)) return CIRCULAR_VALUE;

  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizePayload(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[key] = sensitiveKeys.has(normalizedKey(key))
      ? REDACTED_VALUE
      : sanitizePayload(item, seen);
  }
  seen.delete(value);
  return result;
};

export const sanitizeNetworkLogPayload = (value: unknown) =>
  sanitizePayload(value, new WeakSet());
