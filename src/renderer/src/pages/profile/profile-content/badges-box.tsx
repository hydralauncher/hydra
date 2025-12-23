import { userProfileContext } from "@renderer/context";
import { useFormat } from "@renderer/hooks";
import { useContext, useState } from "react";
import { useTranslation } from "react-i18next";
import { AllBadgesModal } from "./all-badges-modal";
import "./badges-box.scss";

const MAX_VISIBLE_BADGES = 4;

export function BadgesBox() {
  const { userProfile, badges } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();
  const [showAllBadgesModal, setShowAllBadgesModal] = useState(false);

  if (!userProfile?.badges.length) return null;

  const visibleBadges = userProfile.badges.slice(0, MAX_VISIBLE_BADGES);
  const hasMoreBadges = userProfile.badges.length > MAX_VISIBLE_BADGES;

  return (
    <>
      <div>
        <div className="badges-box__section-header">
          <div className="profile-content__section-title-group">
            <h2>{t("badges")}</h2>
            <span className="profile-content__section-badge">
              {numberFormatter.format(userProfile.badges.length)}
            </span>
          </div>
          {hasMoreBadges && (
            <button
              type="button"
              className="badges-box__view-all"
              onClick={() => setShowAllBadgesModal(true)}
            >
              {t("view_all")}
            </button>
          )}
        </div>

        <div className="badges-box__box">
          <div className="badges-box__list">
            {visibleBadges.map((badgeName) => {
              const badge = badges.find((b) => b.name === badgeName);

              if (!badge) return null;

              return (
                <div key={badge.name} className="badges-box__item">
                  <div className="badges-box__item-icon">
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
        </div>
      </div>

      <AllBadgesModal
        visible={showAllBadgesModal}
        onClose={() => setShowAllBadgesModal(false)}
      />
    </>
  );
}
