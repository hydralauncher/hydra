import { useCallback, useEffect } from "react";
import {
  setGamificationFeatures,
  setGamificationProgress,
} from "@renderer/features";
import { ensureArray } from "@renderer/helpers";
import { logger } from "@renderer/logger";
import type { GamificationProgress } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import { Feature, readCachedFeatures } from "./use-feature";

const PROGRESS_REFRESH_INTERVAL_MS = 8 * 60 * 60 * 1000;
const SESSION_SYNC_REFRESH_DELAY_MS = 2000;

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

const toGamificationFeatures = (features: string[], isLoaded: boolean) => ({
  isEnabled: features.includes(Feature.Gamification),
  isShopEnabled: features.includes(Feature.GamificationShop),
  isLoaded,
});

/** Reads the gamification flags on start and whenever the signed-in user changes. */
export function useGamificationFeatureSync() {
  const dispatch = useAppDispatch();
  const userId = useAppSelector((state) => state.userDetails.userDetails?.id);

  useEffect(() => {
    dispatch(
      setGamificationFeatures(
        toGamificationFeatures(readCachedFeatures(), false)
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
          setGamificationFeatures(toGamificationFeatures(features, true))
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

  useEffect(() => {
    if (!userId || !isEnabled) return;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = globalThis.window.electron.onGameSessionSynced(() => {
      clearTimeout(timeout);
      timeout = setTimeout(
        () => void refreshProgress(),
        SESSION_SYNC_REFRESH_DELAY_MS
      );
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, [userId, isEnabled, refreshProgress]);
}
