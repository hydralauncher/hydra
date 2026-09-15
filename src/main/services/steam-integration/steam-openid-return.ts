import type { SteamConnectErrorCode } from "@types";

export const STEAM_CONNECTED_DEEP_LINK = "hydralauncher://steam-connected";

export type SteamOpenIdReturn =
  | { kind: "success" }
  | { kind: "error"; code: SteamConnectErrorCode };

const isSteamConnectedDeepLink = (url: URL) =>
  url.protocol === "hydralauncher:" && url.hostname === "steam-connected";

const readErrorParam = (url: URL): string | null => {
  const value =
    url.searchParams.get("error") ?? url.searchParams.get("oauth_error");
  return value && value.length > 0 ? value : null;
};

export const parseSteamOpenIdErrorBody = (
  text: string
): SteamOpenIdReturn | null => {
  try {
    const parsed = JSON.parse(text) as { message?: unknown };
    if (
      typeof parsed.message === "string" &&
      parsed.message.toLowerCase().includes("already-linked")
    ) {
      return { kind: "error", code: "already-linked" };
    }
  } catch {
    return null;
  }

  return null;
};

export const parseSteamOpenIdReturn = (
  href: string
): SteamOpenIdReturn | null => {
  try {
    const parsed = new URL(href);
    const error = readErrorParam(parsed);
    const haystack = `${parsed.pathname} ${parsed.search} ${error ?? ""}`;

    if (haystack.toLowerCase().includes("already-linked")) {
      return { kind: "error", code: "already-linked" };
    }

    if (error && isSteamConnectedDeepLink(parsed)) {
      return { kind: "error", code: "generic" };
    }

    if (
      isSteamConnectedDeepLink(parsed) ||
      parsed.searchParams.get("oauth_linked_provider") === "steam"
    ) {
      return { kind: "success" };
    }

    return null;
  } catch {
    return null;
  }
};

export const isSteamOpenIdSuccessUrl = (url: string) =>
  parseSteamOpenIdReturn(url)?.kind === "success";
