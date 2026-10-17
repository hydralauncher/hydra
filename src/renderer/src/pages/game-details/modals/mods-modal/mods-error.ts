import type { TFunction } from "i18next";
import { parseModsError, stripIpcErrorPrefix } from "@shared";

const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
};

/**
 * Turns anything thrown by the mod manager into a translated message. Errors
 * from the main process carry a language-neutral code; anything else (for
 * example a network failure) is shown with its original text.
 */
export const translateModsError = (t: TFunction, error: unknown): string => {
  const raw = messageOf(error);
  const parsed = parseModsError(raw);
  if (parsed) return t(`errors.${parsed.code}`, parsed.params);

  const detail = stripIpcErrorPrefix(raw).trim();
  return detail
    ? t("errors.generic", { message: detail })
    : t("errors.generic_short");
};
