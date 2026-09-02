import { LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { REVIEW_MIN_PLAYTIME_IN_MS } from "@renderer/constants";

import "./review-gate-notice.scss";

interface ReviewGateNoticeProps {
  isSignedIn: boolean;
}

const REVIEW_MIN_PLAYTIME_IN_HOURS = REVIEW_MIN_PLAYTIME_IN_MS / 3600000;

export function ReviewGateNotice({
  isSignedIn,
}: Readonly<ReviewGateNoticeProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div className="review-gate-notice">
      <div className="review-gate-notice__icon">
        <LockIcon size={20} />
      </div>

      <div className="review-gate-notice__content">
        <span className="review-gate-notice__title">
          {t("review_locked_title")}
        </span>
        <span className="review-gate-notice__description">
          {isSignedIn
            ? t("review_requires_playtime", {
                count: REVIEW_MIN_PLAYTIME_IN_HOURS,
              })
            : t("review_requires_sign_in")}
        </span>
      </div>
    </div>
  );
}
