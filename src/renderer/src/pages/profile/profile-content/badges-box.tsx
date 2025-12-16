import { userProfileContext } from "@renderer/context";
import { useFormat } from "@renderer/hooks";
import { useContext } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import "./badges-box.scss";

export function BadgesBox() {
  const { userProfile, badges } = useContext(userProfileContext);
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  if (!userProfile?.badges.length) return null;

  return (
    <div>
      <div className="badges-box__section-header">
        <div className="profile-content__section-title-group">
          <h2>{t("badges")}</h2>
          <span className="profile-content__section-badge">
            {numberFormatter.format(userProfile.badges.length)}
          </span>
        </div>
      </div>

      <div className="badges-box__box">
        <div className="badges-box__list">
          {userProfile.badges.map((badgeName) => {
            const badge = badges.find((b) => b.name === badgeName);

            if (!badge) return null;

            return (
              <div
                key={badge.name}
                className="badges-box__item"
                data-tooltip-place="top"
                data-tooltip-content={badge.description}
                data-tooltip-id="badges-box-tooltip"
              >
                <img
                  src={badge.badge.url}
                  alt={badge.name}
                  width={32}
                  height={32}
                />
              </div>
            );
          })}
        </div>

        <Tooltip id="badges-box-tooltip" />
      </div>
    </div>
  );
}
