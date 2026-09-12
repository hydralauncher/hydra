export const STEAM_CONNECTED_DEEP_LINK = "hydralauncher://steam-connected";

const isSteamConnectedDeepLink = (url: URL) =>
  url.protocol === "hydralauncher:" && url.hostname === "steam-connected";

export const isSteamOpenIdSuccessUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    return (
      isSteamConnectedDeepLink(parsed) ||
      parsed.searchParams.get("oauth_linked_provider") === "steam"
    );
  } catch {
    return false;
  }
};
