import { useCallback, useState } from "react";

import {
  parseLeaderboardPeriod,
  parseLeaderboardScope,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "./game-leaderboard";

const PERIOD_STORAGE_KEY = "leaderboard-period";
const SCOPE_STORAGE_KEY = "leaderboard-scope";

export interface LeaderboardFilterOverrides {
  period?: LeaderboardPeriod | null;
  scope?: LeaderboardScope | null;
}

// The period and scope shared by the Rankings page and the game page board.
// `setPeriod` and `setScope` save the choice; `showPeriod` and `showScope` only
// apply it to this screen, for filters that came in a link.
export function useLeaderboardFilters(
  overrides: LeaderboardFilterOverrides = {}
) {
  const [period, showPeriod] = useState<LeaderboardPeriod>(
    () =>
      overrides.period ??
      parseLeaderboardPeriod(localStorage.getItem(PERIOD_STORAGE_KEY))
  );
  const [scope, showScope] = useState<LeaderboardScope>(
    () =>
      overrides.scope ??
      parseLeaderboardScope(localStorage.getItem(SCOPE_STORAGE_KEY))
  );

  const setPeriod = useCallback((value: LeaderboardPeriod) => {
    localStorage.setItem(PERIOD_STORAGE_KEY, value);
    showPeriod(value);
  }, []);

  const setScope = useCallback((value: LeaderboardScope) => {
    localStorage.setItem(SCOPE_STORAGE_KEY, value);
    showScope(value);
  }, []);

  return { period, scope, setPeriod, setScope, showPeriod, showScope };
}
