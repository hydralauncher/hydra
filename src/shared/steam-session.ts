export const isSteamReconnectRequired = (message?: string): boolean =>
  message === "steam-session-required" || message === "steam-account-mismatch";
