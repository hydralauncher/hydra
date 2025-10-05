import { useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat, useUserDetails } from "@renderer/hooks";
import { Award } from "lucide-react";
import "./user-karma-box.scss";

export function UserKarmaBox() {
  const { isMe, userProfile } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  // Get karma from userDetails (for current user) or userProfile (for other users)
  const karma = isMe ? userDetails?.karma : userProfile?.karma;

  // Don't show if karma is not available
  if (karma === undefined || karma === null) return null;

  return (
    <div>
      <div className="user-karma__section-header">
        <h2>{t("karma")}</h2>
      </div>

      <div className="user-karma__box">
        <div className="user-karma__content">
          <div className="user-karma__stats-row">
            <p className="user-karma__description">
              <Award size={20} /> {numberFormatter.format(karma)}{" "}
              {t("karma_count")}
            </p>
          </div>
          <div className="user-karma__info">
            <small className="user-karma__info-text">
              {t("karma_description")}
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
