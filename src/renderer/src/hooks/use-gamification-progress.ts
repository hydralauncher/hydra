import { useCallback, useEffect } from "react";
import { setGamificationProgress } from "@renderer/features";
import { logger } from "@renderer/logger";
import type { GamificationProgress } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";

const PROGRESS_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;

export function useGamificationProgress() {
  const dispatch = useAppDispatch();
  const progress = useAppSelector((state) => state.gamification.progress);

  const refreshProgress = useCallback(async () => {
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<GamificationProgress>(
          "/profile/progress"
        );
      dispatch(setGamificationProgress(response));
      return response;
    } catch (error) {
      logger.error("Failed to load gamification progress", error);
      return null;
    }
  }, [dispatch]);

  return { progress, refreshProgress };
}

export function useGamificationProgressSync() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);
  const { refreshProgress } = useGamificationProgress();

  useEffect(() => {
    if (!userId) {
      dispatch(setGamificationProgress(null));
      return;
    }

    void refreshProgress();
    const interval = setInterval(
      () => void refreshProgress(),
      PROGRESS_REFRESH_INTERVAL_MS
    );

    return () => clearInterval(interval);
  }, [userId, refreshProgress, dispatch]);
}
