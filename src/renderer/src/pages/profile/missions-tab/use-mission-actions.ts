import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  useAppDispatch,
  useAppSelector,
  useFormat,
  useGamificationMissions,
  useGamificationProgress,
  useToast,
} from "@renderer/hooks";
import {
  celebrateReward,
  launchConfetti,
} from "@renderer/components/gamification";
import { setGamificationPendingAction } from "@renderer/features";
import { logger } from "@renderer/logger";
import type { Mission, TrailKey } from "@types";
import { getMissionTitleKey } from "./mission-catalog";

const INSUFFICIENT_COINS_ERROR = "gamification/insufficient-coins";

/**
 * Every mission card and trail control has its own hook instance, so the lock
 * lives here: a second claim would let an older response overwrite newer
 * totals. Redux only mirrors it so the buttons re-render.
 */
let runningActionId: string | null = null;

export function useMissionActions() {
  const { t } = useTranslation("user_profile");
  const { formatNumber } = useFormat();
  const { showSuccessToast, showErrorToast } = useToast();
  const { missions, claimMission, swapMission, claimTrailLevel } =
    useGamificationMissions();
  const { progress } = useGamificationProgress();
  const dispatch = useAppDispatch();
  const pendingAction = useAppSelector(
    (state) => state.gamification.pendingAction
  );

  const showNoFundsToast = useCallback(() => {
    showErrorToast(
      t("swap_no_funds"),
      t("swap_no_funds_message", {
        price: missions?.refresh.price ?? 0,
        balance: formatNumber(progress?.coins ?? 0),
      })
    );
  }, [showErrorToast, t, missions, formatNumber, progress]);

  const run = useCallback(
    async (actionId: string, action: () => Promise<void>) => {
      if (runningActionId) return;
      runningActionId = actionId;
      dispatch(setGamificationPendingAction(actionId));
      try {
        await action();
      } catch (error) {
        logger.error("Gamification action failed", error);
        if (
          error instanceof Error &&
          error.message.includes(INSUFFICIENT_COINS_ERROR)
        ) {
          showNoFundsToast();
        } else {
          showErrorToast(t("gamification_action_failed"));
        }
      } finally {
        runningActionId = null;
        dispatch(setGamificationPendingAction(null));
      }
    },
    [dispatch, showNoFundsToast, showErrorToast, t]
  );

  const claim = useCallback(
    (mission: Mission, origin?: Element) => {
      const originRect = origin?.getBoundingClientRect() ?? null;
      return run(`claim:${mission.kind}:${mission.slot}`, async () => {
        const response = await claimMission(mission.kind, mission.slot);
        if (response.wasClaimed) {
          celebrateReward(originRect, response.xp, response.coins);
        }
        showSuccessToast(
          t("reward_claimed_title", {
            xp: formatNumber(response.xp),
            coins: formatNumber(response.coins),
          }),
          t(
            mission.kind === "daily"
              ? "reward_claimed_daily"
              : "reward_claimed_weekly",
            { title: t(getMissionTitleKey(mission)) }
          )
        );
      });
    },
    [run, claimMission, showSuccessToast, t, formatNumber]
  );

  const isSwapAffordable = useCallback(() => {
    if (!missions) return false;
    return (
      missions.refresh.isFreeAvailable ||
      (progress?.coins ?? 0) >= missions.refresh.price
    );
  }, [missions, progress]);

  const swap = useCallback(
    (mission: Mission) => {
      if (!isSwapAffordable()) {
        showNoFundsToast();
        return Promise.resolve();
      }
      return run(`swap:${mission.kind}:${mission.slot}`, async () => {
        const response = await swapMission(mission.kind, mission.slot);
        const title = t(getMissionTitleKey(response.mission));
        showSuccessToast(
          t("mission_swapped"),
          response.wasFree
            ? t("mission_swapped_free", { title })
            : t("mission_swapped_paid", {
                price: missions?.refresh.price ?? 0,
                title,
              })
        );
      });
    },
    [
      isSwapAffordable,
      showNoFundsToast,
      run,
      swapMission,
      t,
      showSuccessToast,
      missions,
    ]
  );

  const claimTrail = useCallback(
    (trail: TrailKey, level: number, origin?: Element) => {
      const originRect = origin?.getBoundingClientRect() ?? null;
      return run(`trail:${trail}:${level}`, async () => {
        const response = await claimTrailLevel(trail, level);
        if (response.wasClaimed) {
          launchConfetti(originRect);
        }
        showSuccessToast(
          t("reward_claimed_title", {
            xp: formatNumber(response.xp),
            coins: formatNumber(response.coins),
          }),
          t("reward_claimed_trail", { trail: t(`trail_${trail}`), level })
        );
      });
    },
    [run, claimTrailLevel, showSuccessToast, t, formatNumber]
  );

  return {
    claim,
    swap,
    claimTrail,
    isSwapAffordable,
    pendingAction,
  };
}
