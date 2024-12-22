import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { gameDetailsContext } from "@renderer/context";
import * as styles from "./achievement-panel.css";

import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { ComparedAchievements } from "@types";
import { SPACING_UNIT } from "@renderer/theme.css";

export interface ComparedAchievementPanelProps {
  achievements: ComparedAchievements;
}

export function ComparedAchievementPanel({
  achievements,
}: ComparedAchievementPanelProps) {
  const { t } = useTranslation("game_details");

  const {} = useContext(gameDetailsContext);

  return (
    <>
      <div
        className={styles.panel}
        style={{
          display: "grid",
          gridTemplateColumns:
            achievements.owner.achievementsPointsEarnedSum !== undefined
              ? "3fr 1fr 1fr"
              : "3fr 2fr",
        }}
      >
        <div style={{ display: "flex", gap: `${SPACING_UNIT}px` }}>
          Total de pontos: <HydraIcon width={20} height={20} /> 4200
        </div>
        {achievements.owner.achievementsPointsEarnedSum !== undefined && (
          <div className={styles.content}>
            <HydraIcon width={20} height={20} />
            {achievements.owner.achievementsPointsEarnedSum}
          </div>
        )}
        <div className={styles.content}>
          <HydraIcon width={20} height={20} />
          {achievements.target.achievementsPointsEarnedSum}
        </div>
      </div>
    </>
  );
}
