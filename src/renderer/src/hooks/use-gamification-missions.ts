import { useCallback } from "react";
import {
  applyRewardProgress,
  setGamificationMissions,
  setGamificationTrails,
} from "@renderer/features";
import { logger } from "@renderer/logger";
import type {
  MissionKind,
  MissionRefreshResponse,
  MissionsResponse,
  RewardClaimResponse,
  Trail,
  TrailKey,
} from "@types";
import { useAppDispatch, useAppSelector } from "./redux";

export function useGamificationMissions() {
  const dispatch = useAppDispatch();
  const missions = useAppSelector((state) => state.gamification.missions);
  const trails = useAppSelector((state) => state.gamification.trails);

  const refreshMissions = useCallback(async () => {
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<MissionsResponse>(
          "/profile/missions"
        );
      dispatch(setGamificationMissions(response));
      return true;
    } catch (error) {
      logger.error("Failed to load missions", error);
      return false;
    }
  }, [dispatch]);

  const refreshTrails = useCallback(async () => {
    try {
      const response =
        await globalThis.window.electron.hydraApi.get<Trail[]>(
          "/profile/trails"
        );
      dispatch(setGamificationTrails(response));
    } catch (error) {
      logger.error("Failed to load trails", error);
    }
  }, [dispatch]);

  const claimMission = useCallback(
    async (kind: MissionKind, slot: number) => {
      const response =
        await globalThis.window.electron.hydraApi.post<RewardClaimResponse>(
          `/profile/missions/${kind}/${slot}/claim`
        );
      dispatch(applyRewardProgress(response.progress));
      await refreshMissions();
      return response;
    },
    [dispatch, refreshMissions]
  );

  const swapMission = useCallback(
    async (kind: MissionKind, slot: number) => {
      const response =
        await globalThis.window.electron.hydraApi.post<MissionRefreshResponse>(
          `/profile/missions/${kind}/${slot}/refresh`
        );
      dispatch(applyRewardProgress(response.progress));
      await refreshMissions();
      return response;
    },
    [dispatch, refreshMissions]
  );

  const claimTrailLevel = useCallback(
    async (trail: TrailKey, level: number) => {
      const response =
        await globalThis.window.electron.hydraApi.post<RewardClaimResponse>(
          `/profile/trails/${trail}/levels/${level}/claim`
        );
      dispatch(applyRewardProgress(response.progress));
      await refreshTrails();
      return response;
    },
    [dispatch, refreshTrails]
  );

  return {
    missions,
    trails,
    refreshMissions,
    refreshTrails,
    claimMission,
    swapMission,
    claimTrailLevel,
  };
}
