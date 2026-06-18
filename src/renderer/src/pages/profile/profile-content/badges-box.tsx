import { userProfileContext } from "@renderer/context";
import { useContext, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import { useDate } from "@renderer/hooks";
import { AllBadgesModal } from "./all-badges-modal";
import "./badges-box.scss";

const MAX_VISIBLE_BADGES = 4;

export function BadgesBox() {
  const { userProfile, badges } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { formatDate } = useDate();
  const tooltipId = useId();
  const [showAllBadgesModal, setShowAllBadgesModal] = useState(false);

  if (!userProfile?.badges.length) return null;

  const visibleBadges = userProfile.badges.slice(0, MAX_VISIBLE_BADGES);
  const hasMoreBadges = userProfile.badges.length > MAX_VISIBLE_BADGES;

  const unlockDates = new Map(
    userProfile.badgesDetails?.map((b) => [b.badge, b.unlockedAt])
  );

  return (
    <>
      <div className="badges-box__box">
        <div className="badges-box__list">
          {visibleBadges.map((badgeName) => {
            const badge = badges.find((b) => b.name === badgeName);

            if (!badge) return null;

            const unlockedAt = unlockDates.get(badgeName);
            const tooltipContent = unlockedAt
              ? t("badge_unlocked_on", { date: formatDate(unlockedAt) })
              : undefined;

            return (
              <div key={badge.name} className="badges-box__item">
                <div
                  className="badges-box__item-icon"
                  data-tooltip-id={tooltipId}
                  data-tooltip-place="top"
                  data-tooltip-content={tooltipContent}
                >
                  <img
                    src={badge.badge.url}
                    alt={badge.name}
                    width={32}
                    height={32}
                  />
                </div>
                <div className="badges-box__item-content">
                  <h3 className="badges-box__item-title">{badge.title}</h3>
                  <p className="badges-box__item-description">
                    {badge.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
        {hasMoreBadges && (
          <div className="badges-box__view-all-container">
            <button
              type="button"
              className="badges-box__view-all"
              onClick={() => setShowAllBadgesModal(true)}
            >
              {t("view_all")}
            </button>
          </div>
        )}
      </div>

      <Tooltip id={tooltipId} />

      <AllBadgesModal
        visible={showAllBadgesModal}
        onClose={() => setShowAllBadgesModal(false)}
      />
    </>
  );
}
