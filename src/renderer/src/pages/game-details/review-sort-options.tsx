import { CalendarIcon, StarIcon, ThumbsupIcon, ClockIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./review-sort-options.scss";

type ReviewSortOption = "newest" | "oldest" | "score_high" | "score_low" | "most_voted";

interface ReviewSortOptionsProps {
  sortBy: ReviewSortOption;
  onSortChange: (sortBy: ReviewSortOption) => void;
}

export function ReviewSortOptions({ sortBy, onSortChange }: ReviewSortOptionsProps) {
  const { t } = useTranslation("game_details");

  return (
    <div className="review-sort-options__container">
      <div className="review-sort-options__options">
        <button
          className={`review-sort-options__option ${sortBy === "newest" ? "active" : ""}`}
          onClick={() => onSortChange("newest")}
        >
          <CalendarIcon size={16} />
          <span>{t("sort_newest")}</span>
        </button>
        <span className="review-sort-options__separator">|</span>
        <button
          className={`review-sort-options__option ${sortBy === "oldest" ? "active" : ""}`}
          onClick={() => onSortChange("oldest")}
        >
          <ClockIcon size={16} />
          <span>{t("sort_oldest")}</span>
        </button>
        <span className="review-sort-options__separator">|</span>
        <button
          className={`review-sort-options__option ${sortBy === "score_high" ? "active" : ""}`}
          onClick={() => onSortChange("score_high")}
        >
          <StarIcon size={16} />
          <span>{t("sort_highest_score")}</span>
        </button>
        <span className="review-sort-options__separator">|</span>
        <button
          className={`review-sort-options__option ${sortBy === "score_low" ? "active" : ""}`}
          onClick={() => onSortChange("score_low")}
        >
          <StarIcon size={16} />
          <span>{t("sort_lowest_score")}</span>
        </button>
        <span className="review-sort-options__separator">|</span>
        <button
          className={`review-sort-options__option ${sortBy === "most_voted" ? "active" : ""}`}
          onClick={() => onSortChange("most_voted")}
        >
          <ThumbsupIcon size={16} />
          <span>{t("sort_most_voted")}</span>
        </button>
      </div>
    </div>
  );
}