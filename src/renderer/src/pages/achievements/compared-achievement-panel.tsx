import { useTranslation } from "react-i18next";
import * as styles from "./achievement-panel.css";

import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { ComparedAchievements } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";
import { useUserDetails } from "@renderer/hooks";

export interface ComparedAchievementPanelProps {
  achievements: ComparedAchievements;
}

export function ComparedAchievementPanel({
  achievements,
}: ComparedAchievementPanelProps) {
  const { t } = useTranslation("achievement");
  const { hasActiveSubscription } = useUserDetails();

  return (
    <div
      className={styles.panel}
      style={{
        display: "grid",
        gridTemplateColumns: hasActiveSubscription ? "3fr 1fr 1fr" : "3fr 2fr",
        gap: `${SPACING_UNIT * 2}px`,
      }}
    >
      <div style={{ display: "flex", gap: `${SPACING_UNIT}px` }}>
        {t("available_points")} <HydraIcon width={20} height={20} />{" "}
        {achievements.achievementsPointsTotal}
      </div>
      {hasActiveSubscription && (
        <div className={styles.content}>
          <HydraIcon width={20} height={20} />
          {achievements.owner.achievementsPointsEarnedSum ?? 0}
        </div>
      )}
      <div className={styles.content}>
        <HydraIcon width={20} height={20} />
        {achievements.target.achievementsPointsEarnedSum}
      </div>
    </div>
  );
}
