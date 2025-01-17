import { useTranslation } from "react-i18next";

import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { ComparedAchievements } from "@types";
import { useUserDetails } from "@renderer/hooks";

import "./achievement-panel.scss";
import "../../scss/_variables.scss";

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
      className={classNames("achievement-panel", {
        "achievement-panel--subscribed": hasActiveSubscription,
      })}
    >
      <div className="achievement-panel__points">
        {t("available_points")}
        <HydraIcon width={20} height={20} />
        {achievements.achievementsPointsTotal}
      </div>

      {hasActiveSubscription && (
        <div className="achievement-panel__content">
          <HydraIcon width={20} height={20} />
          {achievements.owner.achievementsPointsEarnedSum ?? 0}
        </div>
      )}

      <div className="achievement-panel__content">
        <HydraIcon width={20} height={20} />
        {achievements.target.achievementsPointsEarnedSum}
      </div>
    </div>
  );
}