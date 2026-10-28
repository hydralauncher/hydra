import { useEffect } from "react";
import { showLevelUp } from "@renderer/features";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";

const LAST_LEVEL_STORAGE_PREFIX = "hydra:gamification:last-level:";
const SHOW_DELAY_MS = 900;

const readLastLevel = (key: string) => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : Number(raw);
  } catch {
    return null;
  }
};

const writeLastLevel = (key: string, level: number) => {
  try {
    window.localStorage.setItem(key, String(level));
  } catch {
    // Storage can be unavailable; the overlay then shows on every level it sees go up.
  }
};

/**
 * Opens the level-up overlay when the user's level goes above the last level seen on this device,
 * whether it came from a claim or from a progress refresh. The first run only stores the level.
 */
export function useLevelUpWatcher() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);
  const level = useAppSelector((state) => state.gamification.progress?.level);

  useEffect(() => {
    if (!userId || level === undefined) return;
    const key = `${LAST_LEVEL_STORAGE_PREFIX}${userId}`;
    const lastLevel = readLastLevel(key);
    const shouldShow = lastLevel !== null && level > lastLevel;

    // Deferred so a render where the user changed but the old progress is still in the store
    // gets cancelled before it writes anything.
    const timeout = setTimeout(
      () => {
        writeLastLevel(key, level);
        if (shouldShow) dispatch(showLevelUp(level));
      },
      shouldShow ? SHOW_DELAY_MS : 0
    );
    return () => clearTimeout(timeout);
  }, [userId, level, dispatch]);
}
