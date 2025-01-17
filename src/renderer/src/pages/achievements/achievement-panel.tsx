import { useTranslation } from "react-i18next";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { UserAchievement } from "@types";
import { useSubscription } from "@renderer/hooks/use-subscription";
import { useUserDetails } from "@renderer/hooks";


import "./achievement-panel.sccs";

export interface AchievementPanelProps {
  achievements: UserAchievement[];
}

export function AchievementPanel({ achievements }: AchievementPanelProps) {
  const { t } = useTranslation("achievement");
  const { hasActiveSubscription } = useUserDetails();
  const { showHydraCloudModal } = useSubscription();

  const achievementsPointsTotal = achievements.reduce(
    (acc, achievement) => acc + (achievement.points ?? 0),
    0
  );

  const achievementsPointsEarnedSum = achievements.reduce(
    (acc, achievement) =>
      acc + (achievement.unlocked ? (achievement.points ?? 0) : 0),
    0
  );

  if (!hasActiveSubscription) {
    return (
      <div className="achievement-panel">
        <div className="achievement-panel__content">
          {t("earned_points")} <HydraIcon width={20} height={20} />
          ??? / ???
        </div>
        <button
          type="button"
          onClick={() => showHydraCloudModal("achievements-points")}
          className={styles.link}
        >
          <small style={{ color: "#ffc107" }}>
            {t("how_to_earn_achievements_points")}
          </small>
        </button>
      </div>
    );
  }

  return (
    <div className="achievement-panel">
      <div className="achievement-panel__content">
        {t("earned_points")} <HydraIcon width={20} height={20} />
        {achievementsPointsEarnedSum} / {achievementsPointsTotal}
      </div>
    </div>
  );
}
