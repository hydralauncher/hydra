import { useTranslation } from "react-i18next";
import { Button } from "@renderer/components";
import "./review-prompt-banner.scss";

interface ReviewPromptBannerProps {
  /** Rendered invisible to hold the banner's space until it is confirmed. */
  pending?: boolean;
  onYesClick: () => void;
  onLaterClick: () => void;
}

export function ReviewPromptBanner({
  pending = false,
  onYesClick,
  onLaterClick,
}: Readonly<ReviewPromptBannerProps>) {
  const { t } = useTranslation("game_details");

  return (
    <div
      className={`review-prompt-banner${pending ? " review-prompt-banner--pending" : ""}`}
      aria-hidden={pending}
    >
      <div className="review-prompt-banner__content">
        <div className="review-prompt-banner__text">
          <span className="review-prompt-banner__playtime">
            {t("you_seemed_to_enjoy_this_game")}
          </span>
          <span className="review-prompt-banner__question">
            {t("would_you_recommend_this_game")}
          </span>
        </div>
        <div className="review-prompt-banner__actions">
          <Button theme="outline" onClick={onLaterClick}>
            {t("maybe_later")}
          </Button>
          <Button theme="primary" onClick={onYesClick}>
            {t("yes")}
          </Button>
        </div>
      </div>
    </div>
  );
}
