import {
  ThumbsupIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./review-sort-options.scss";

type ReviewSortOption =
  | "newest"
  | "oldest"
  | "score_high"
  | "score_low"
  | "most_voted";

interface ReviewSortOptionsProps {
  sortBy: ReviewSortOption;
  onSortChange: (sortBy: ReviewSortOption) => void;
}

export function ReviewSortOptions({
  sortBy,
  onSortChange,
}: ReviewSortOptionsProps) {
  const { t } = useTranslation("game_details");

  const handleDateToggle = () => {
    const newSort = sortBy === "newest" ? "oldest" : "newest";
    onSortChange(newSort);
  };

  const handleScoreToggle = () => {
    const newSort = sortBy === "score_high" ? "score_low" : "score_high";
    onSortChange(newSort);
  };

  const handleMostVotedClick = () => {
    onSortChange("most_voted");
  };

  const isDateActive = sortBy === "newest" || sortBy === "oldest";
  const isScoreActive = sortBy === "score_high" || sortBy === "score_low";
  const isMostVotedActive = sortBy === "most_voted";

  return (
    <div className="review-sort-options__container">
      <div className="review-sort-options__options">
        <button
          className={`review-sort-options__option review-sort-options__toggle-option ${isDateActive ? "active" : ""}`}
          onClick={handleDateToggle}
        >
          {sortBy === "newest" ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
          <span>{sortBy === "oldest" ? t("sort_oldest") : t("sort_newest")}</span>
        </button>
        <span className="review-sort-options__separator">|</span>
        <button
          className={`review-sort-options__option review-sort-options__toggle-option ${isScoreActive ? "active" : ""}`}
          onClick={handleScoreToggle}
        >
          {sortBy === "score_high" ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
          <span>{sortBy === "score_low" ? t("sort_lowest_score") : t("sort_highest_score")}</span>
        </button>
        <span className="review-sort-options__separator">|</span>
        <button
          className={`review-sort-options__option ${isMostVotedActive ? "active" : ""}`}
          onClick={handleMostVotedClick}
        >
          <ThumbsupIcon size={16} />
          <span>{t("sort_most_voted")}</span>
        </button>
      </div>
    </div>
  );
}
