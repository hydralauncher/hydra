import { useContext } from "react";
import { userProfileContext } from "@renderer/context";
import { useTranslation } from "react-i18next";
import { useFormat } from "@renderer/hooks";
import { Award } from "lucide-react";
import { useUserDetails } from "@renderer/hooks";
import "./user-karma-box.scss";

export function UserKarmaBox() {
  const { isMe } = useContext(userProfileContext);
  const { userDetails } = useUserDetails();
  const { t } = useTranslation("user_profile");
  const { numberFormatter } = useFormat();

  // Only show karma for the current user (me)
  if (!isMe || !userDetails) return null;

  return (
    <div>
      <div className="user-karma__section-header">
        <h2>{t("karma")}</h2>
      </div>

      <div className="user-karma__box">
        <div className="user-karma__content">
          <div className="user-karma__stats-row">
            <p className="user-karma__description">
              <Award size={20} /> {numberFormatter.format(userDetails.karma)}{" "}
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
