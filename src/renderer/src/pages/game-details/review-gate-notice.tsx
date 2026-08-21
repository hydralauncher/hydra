import { LockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { useFormat } from "@renderer/hooks";
import {
  MAX_MINUTES_TO_SHOW_IN_PLAYTIME,
  REVIEW_MIN_PLAYTIME_IN_MS,
} from "@renderer/constants";

import "./review-gate-notice.scss";

interface ReviewGateNoticeProps {
  isSignedIn: boolean;
}

export function ReviewGateNotice({
  isSignedIn,
}: Readonly<ReviewGateNoticeProps>) {
  const { t } = useTranslation("game_details");
  const { numberFormatter } = useFormat();

  const formatPlayTime = (milliseconds: number) => {
    const minutes = milliseconds / 60000;

    if (minutes < MAX_MINUTES_TO_SHOW_IN_PLAYTIME) {
      return t("amount_minutes", { amount: minutes.toFixed(0) });
    }

    const hours = minutes / 60;
    return t("amount_hours", { amount: numberFormatter.format(hours) });
  };

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
                amount: formatPlayTime(REVIEW_MIN_PLAYTIME_IN_MS),
              })
            : t("review_requires_sign_in")}
        </span>
      </div>
    </div>
  );
}
