import type { SteamSyncState } from "@types";

export type SteamProgressPresentation =
  | { mode: "indeterminate"; percentage: null; showCount: false }
  | { mode: "determinate"; percentage: number; showCount: true };

export const getSteamProgressPresentation = (
  state: SteamSyncState
): SteamProgressPresentation | null => {
  if (state.status === "idle") return null;
  if (state.status === "cancelling") {
    return { mode: "indeterminate", percentage: null, showCount: false };
  }

  const hasKnownTotal =
    (state.phase === "achievements" || state.phase === "publishing") &&
    state.gamesFound > 0;

  if (!hasKnownTotal) {
    return { mode: "indeterminate", percentage: null, showCount: false };
  }

  const percentage = Math.min(
    100,
    Math.max(0, (state.gamesProcessed / state.gamesFound) * 100)
  );

  return { mode: "determinate", percentage, showCount: true };
};
