import { useTranslation } from "react-i18next";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import { ComparedAchievements } from "@types";
import { useUserDetails } from "@renderer/hooks";
import "./achievement-panel.scss";

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
      className={`achievement-panel achievement-panel__grid ${
        hasActiveSubscription
          ? "achievement-panel__grid--with-subscription"
          : "achievement-panel__grid--without-subscription"
      }`}
    >
      <div className="achievement-panel__points-container">
        {t("available_points")}{" "}
        <HydraIcon className="achievement-panel__content-icon" />{" "}
        {achievements.achievementsPointsTotal}
      </div>
      {hasActiveSubscription && (
        <div className="achievement-panel__content">
          <HydraIcon className="achievement-panel__content-icon" />
          {achievements.owner.achievementsPointsEarnedSum ?? 0}
        </div>
      )}
      <div className="achievement-panel__content">
        <HydraIcon className="achievement-panel__content-icon" />
        {achievements.target.achievementsPointsEarnedSum}
      </div>
    </div>
  );
}
