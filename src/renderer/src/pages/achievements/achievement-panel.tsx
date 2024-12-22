import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";
import * as styles from "./achievement-panel.css";

import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { UserAchievement } from "@types";

export interface AchievementPanelProps {
  achievements: UserAchievement[];
}

export function AchievementPanel({ achievements }: AchievementPanelProps) {
  const { t } = useTranslation("achievement");

  const achievementsPointsTotal = achievements.reduce(
    (acc, achievement) => acc + (achievement.points ?? 0),
    0
  );

  const achievementsPointsEarnedSum = achievements.reduce(
    (acc, achievement) =>
      acc + (achievement.unlocked ? (achievement.points ?? 0) : 0),
    0
  );

  const {} = useContext(gameDetailsContext);

  return (
    <>
      <div className={styles.panel}>
        <div className={styles.content}>
          {t("earned_points")} <HydraIcon width={20} height={20} />
          {achievementsPointsEarnedSum} / {achievementsPointsTotal}
        </div>
      </div>
    </>
  );
}
