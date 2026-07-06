export const getErrorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;

  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized !== "{}") return serialized;
  } catch {
    /* value is not serializable, fall through */
  }

  return "Unknown error";
};

export const getErrorStack = (value: unknown): string =>
  value instanceof Error && value.stack ? value.stack : "";
