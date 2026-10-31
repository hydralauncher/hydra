import type { SteamSyncPhase, SteamSyncState } from "@types";

export type SteamProgressLabelKey =
  | "steam_syncing"
  | "steam_sync_uploading"
  | "steam_sync_updating_library"
  | "steam_sync_scanning_games"
  | "steam_sync_finishing";

export type SteamProgressPresentation =
  | {
      mode: "indeterminate";
      percentage: null;
      showCount: false;
      labelKey: SteamProgressLabelKey;
    }
  | {
      mode: "determinate";
      percentage: number;
      showCount: boolean;
      labelKey: SteamProgressLabelKey;
    };

const PHASE_PROGRESS_RANGES: Partial<
  Record<SteamSyncPhase, readonly [number, number]>
> = {
  achievements: [0, 60],
  publishing: [60, 70],
  merging: [70, 95],
  executables: [95, 100],
  finishing: [100, 100],
};

const PHASE_LABEL_KEYS: Partial<Record<SteamSyncPhase, SteamProgressLabelKey>> =
  {
    publishing: "steam_sync_uploading",
    merging: "steam_sync_updating_library",
    executables: "steam_sync_scanning_games",
    finishing: "steam_sync_finishing",
  };

const PHASES_WITH_GAME_COUNT = new Set<SteamSyncPhase>([
  "achievements",
  "merging",
  "executables",
]);

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const getSteamProgressPresentation = (
  state: SteamSyncState
): SteamProgressPresentation | null => {
  if (state.status === "idle") return null;
  if (state.status === "cancelling") {
    return {
      mode: "indeterminate",
      percentage: null,
      showCount: false,
      labelKey: "steam_syncing",
    };
  }

  const labelKey = PHASE_LABEL_KEYS[state.phase] ?? "steam_syncing";
  const range = PHASE_PROGRESS_RANGES[state.phase];
  const hasKnownTotal = state.gamesFound > 0;

  if (!range || (state.phase === "achievements" && !hasKnownTotal)) {
    return {
      mode: "indeterminate",
      percentage: null,
      showCount: false,
      labelKey,
    };
  }

  const [start, end] = range;
  const fraction = hasKnownTotal
    ? clamp(state.gamesProcessed / state.gamesFound, 0, 1)
    : 0;

  return {
    mode: "determinate",
    percentage: start + (end - start) * fraction,
    showCount: hasKnownTotal && PHASES_WITH_GAME_COUNT.has(state.phase),
    labelKey,
  };
};
