import {
  encodeModsError,
  type ModsErrorCode,
  type ModsErrorParams,
} from "@shared";

/**
 * Carries a language-neutral code in its message; the renderer translates it.
 * Never put user-facing English in these errors.
 */
export class ModsError extends Error {
  readonly code: ModsErrorCode;

  constructor(code: ModsErrorCode, params?: ModsErrorParams) {
    super(encodeModsError(code, params));
    this.name = "ModsError";
    this.code = code;
  }
}
