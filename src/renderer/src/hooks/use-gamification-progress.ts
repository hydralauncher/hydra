import { useCallback, useEffect } from "react";
import {
  setGamificationEnabled,
  setGamificationProgress,
} from "@renderer/features";
import { ensureArray } from "@renderer/helpers";
import { logger } from "@renderer/logger";
import type { GamificationProgress } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import { Feature, readCachedFeatures } from "./use-feature";

const PROGRESS_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;

export function useGamificationProgress() {
  const dispatch = useAppDispatch();
  const progress = useAppSelector((state) => state.gamification.progress);
  const isEnabled = useAppSelector((state) => state.gamification.isEnabled);

  const refreshProgress = useCallback(async () => {
    if (!isEnabled) return null;
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
  }, [dispatch, isEnabled]);

  return { progress, refreshProgress };
}

/** Reads the GAMIFICATION flag on start and whenever the signed-in user changes. */
export function useGamificationFeatureSync() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);

  useEffect(() => {
    dispatch(
      setGamificationEnabled(
        readCachedFeatures().includes(Feature.Gamification)
      )
    );
  }, [dispatch]);

  useEffect(() => {
    let cancelled = false;
    globalThis.window.electron.hydraApi
      .get<string[]>("/features", { needsAuth: false })
      .then((response) => {
        if (cancelled) return;
        const features = ensureArray<string>(response, "/features");
        localStorage.setItem("features", JSON.stringify(features));
        dispatch(
          setGamificationEnabled(features.includes(Feature.Gamification))
        );
      })
      .catch((error) => logger.error("Failed to load features", error));
    return () => {
      cancelled = true;
    };
  }, [userId, dispatch]);
}

export function useGamificationProgressSync() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);
  const isEnabled = useAppSelector((state) => state.gamification.isEnabled);
  const { refreshProgress } = useGamificationProgress();

  useEffect(() => {
    if (!userId || !isEnabled) {
      dispatch(setGamificationProgress(null));
      return;
    }

    void refreshProgress();
    const interval = setInterval(
      () => void refreshProgress(),
      PROGRESS_REFRESH_INTERVAL_MS
    );

    return () => clearInterval(interval);
  }, [userId, isEnabled, refreshProgress, dispatch]);
}
