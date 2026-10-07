import type { EpicErrorCode } from "../../../types/epic-integration.types";

// Public OAuth client used by the pinned Legendary 0.21.1 release.
export const EPIC_OAUTH_CLIENT_ID = "34a02cf8f4414e29b15921876da36f9a";
export const EPIC_AUTH_CODE_MAX_LENGTH = 4096;

export class EpicIntegrationError extends Error {
  constructor(public readonly code: EpicErrorCode) {
    super(code);
    this.name = "EpicIntegrationError";
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function validateEpicAuthorizationCode(input: unknown): string {
  if (typeof input !== "string" || !/^[a-zA-Z0-9_-]{16,512}$/.test(input)) {
    throw new EpicIntegrationError("invalid-response");
  }
  return input;
}

export function parseEpicAuthorizationResponse(input: unknown): string {
  if (typeof input !== "string" || input.length > EPIC_AUTH_CODE_MAX_LENGTH) {
    throw new EpicIntegrationError("invalid-response");
  }
  try {
    const parsed: unknown = JSON.parse(input);
    return validateEpicAuthorizationCode(
      isRecord(parsed) ? parsed.authorizationCode : undefined
    );
  } catch {
    throw new EpicIntegrationError("invalid-response");
  }
}

export function getEpicLoginUrl() {
  const redirect = new URL("https://www.epicgames.com/id/api/redirect");
  redirect.searchParams.set("clientId", EPIC_OAUTH_CLIENT_ID);
  redirect.searchParams.set("responseType", "code");
  const login = new URL("https://www.epicgames.com/id/login");
  login.searchParams.set("redirectUrl", redirect.toString());
  return login.toString();
}

export function isEpicAuthorizationReturn(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname === "www.epicgames.com" &&
      (parsed.port === "" || parsed.port === "443") &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.pathname === "/id/api/redirect" &&
      parsed.searchParams.getAll("clientId").length === 1 &&
      parsed.searchParams.get("clientId") === EPIC_OAUTH_CLIENT_ID &&
      parsed.searchParams.getAll("responseType").length === 1 &&
      parsed.searchParams.get("responseType") === "code"
    );
  } catch {
    return false;
  }
}

export function isHttpsNavigation(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

export function validateLegendarySession(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.account_id !== "string" ||
    !/^[a-fA-F0-9]{32}$/.test(value.account_id) ||
    typeof value.displayName !== "string" ||
    !value.displayName.trim() ||
    typeof value.access_token !== "string" ||
    !value.access_token ||
    typeof value.refresh_token !== "string" ||
    !value.refresh_token ||
    typeof value.expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.expires_at)) ||
    typeof value.refresh_expires_at !== "string" ||
    !Number.isFinite(Date.parse(value.refresh_expires_at))
  ) {
    throw new EpicIntegrationError("auth-failed");
  }
  if (
    value.client_id !== undefined &&
    value.client_id !== EPIC_OAUTH_CLIENT_ID
  ) {
    throw new EpicIntegrationError("oauth-client-mismatch");
  }
  return value;
}

export function validateLegendaryVersion(value: unknown) {
  if (!isRecord(value) || !isRecord(value.data)) {
    throw new EpicIntegrationError("invalid-response");
  }
  const config = value.data.egl_config;
  if (
    isRecord(config) &&
    config.client_id !== undefined &&
    config.client_id !== EPIC_OAUTH_CLIENT_ID
  ) {
    throw new EpicIntegrationError("oauth-client-mismatch");
  }
  return value;
}
