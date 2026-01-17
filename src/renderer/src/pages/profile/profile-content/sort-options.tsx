import { TrophyIcon, ClockIcon, HistoryIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";
import "./sort-options.scss";

type SortOption = "playtime" | "achievementCount" | "playedRecently";

interface SortOptionsProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
}

export function SortOptions({ sortBy, onSortChange }: SortOptionsProps) {
  const { t } = useTranslation("user_profile");

  return (
    <div className="sort-options__container">
      <span className="sort-options__label">{t("sort_by")}</span>
      <div className="sort-options__options">
        <button
          className={`sort-options__option ${sortBy === "achievementCount" ? "active" : ""}`}
          onClick={() => onSortChange("achievementCount")}
        >
          <TrophyIcon size={16} />
          <span>{t("achievements_earned")}</span>
        </button>
        <span className="sort-options__separator">|</span>
        <button
          className={`sort-options__option ${sortBy === "playedRecently" ? "active" : ""}`}
          onClick={() => onSortChange("playedRecently")}
        >
          <HistoryIcon size={16} />
          <span>{t("played_recently")}</span>
        </button>
        <span className="sort-options__separator">|</span>
        <button
          className={`sort-options__option ${sortBy === "playtime" ? "active" : ""}`}
          onClick={() => onSortChange("playtime")}
        >
          <ClockIcon size={16} />
          <span>{t("playtime")}</span>
        </button>
      </div>
    </div>
  );
}
