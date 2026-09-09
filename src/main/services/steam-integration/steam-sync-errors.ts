export class SteamSyncAbortedError extends Error {
  constructor() {
    super("steam-sync-aborted");
    this.name = "SteamSyncAbortedError";
  }
}

export class SteamSyncInProgressError extends Error {
  constructor() {
    super("steam-sync-in-progress");
    this.name = "SteamSyncInProgressError";
  }
}

export class SteamPrivateProfileError extends Error {
  constructor() {
    super("steam-profile-private");
    this.name = "SteamPrivateProfileError";
  }
}

export class SteamSyncRunNotPendingError extends Error {
  constructor() {
    super("profile/steam-sync-run-not-pending");
    this.name = "SteamSyncRunNotPendingError";
  }
}

export const isSteamSyncAbortError = (error: unknown) => {
  if (error instanceof SteamSyncAbortedError) return true;
  if (error instanceof Error && error.name === "AbortError") return true;
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ERR_CANCELED"
  ) {
    return true;
  }

  return false;
};
