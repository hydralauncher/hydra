import { StarIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import "./review-prompt-banner.scss";

interface ReviewPromptBannerProps {
  onYesClick: () => void;
  onLaterClick: () => void;
}

export function ReviewPromptBanner({
  onYesClick,
  onLaterClick,
}: Readonly<ReviewPromptBannerProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div className="review-prompt-banner">
      <div className="review-prompt-banner__icon" aria-hidden="true">
        <StarIcon size={20} />
      </div>
      <div className="review-prompt-banner__text">
        <span className="review-prompt-banner__playtime">
          {t("you_seemed_to_enjoy_this_game")}
        </span>
        <span className="review-prompt-banner__question">
          {t("would_you_recommend_this_game")}
        </span>
      </div>
      <div className="review-prompt-banner__actions">
        <Button
          theme="outline"
          className="review-prompt-banner__later"
          onClick={onLaterClick}
        >
          {t("maybe_later")}
        </Button>
        <Button
          theme="primary"
          className="review-prompt-banner__confirm"
          onClick={onYesClick}
        >
          {t("yes")}
        </Button>
      </div>
    </div>
  );
}
