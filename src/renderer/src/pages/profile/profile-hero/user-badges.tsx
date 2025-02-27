import BadgeThemeCreator from "@renderer/assets/icons/badge-theme-creator.svg?react";
import "./profile-hero.scss";
import { useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { UserBadge } from "@types";
import { useTranslation } from "react-i18next";

export function UserBadges() {
  const { t } = useTranslation("badge");
  const { userProfile } = useContext(userProfileContext);

  if (!userProfile?.badges?.length) return null;

  const getBadgeIcon = (badge: UserBadge) => {
    if (badge === "THEME_CREATOR") {
      return <BadgeThemeCreator width={24} height={24} />;
    }

    return null;
  };

  return (
    <div className="profile-hero__display-name-badges-container">
      {userProfile.badges.map((badge) => {
        const badgeIcon = getBadgeIcon(badge);

        if (!badgeIcon) return null;
        return (
          <div
            className={`badge__${badge.toLowerCase()}`}
            key={badge}
            title={t(`badge_description_${badge.toLowerCase()}`)}
          >
            {badgeIcon}
          </div>
        );
      })}
    </div>
  );
}
