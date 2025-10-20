import { useTranslation } from "react-i18next";
import "./filter-options.scss";

export type FilterOption = "all" | "favourited" | "new" | "top10";

interface FilterOptionsProps {
  filterBy: FilterOption;
  onFilterChange: (filterBy: FilterOption) => void;
  allGamesCount: number;
  favouritedCount: number;
  newGamesCount: number;
  top10Count: number;
}

export function FilterOptions({
  filterBy,
  onFilterChange,
  allGamesCount,
  favouritedCount,
  newGamesCount,
  top10Count,
}: FilterOptionsProps) {
  const { t } = useTranslation("library");

  return (
    <div className="library-filter-options__container">
      <button
        className={`library-filter-options__option ${filterBy === "all" ? "active" : ""}`}
        onClick={() => onFilterChange("all")}
      >
        <span className="library-filter-options__label">{t("all_games")}</span>
        <span className="library-filter-options__count">{allGamesCount}</span>
      </button>
      <button
        className={`library-filter-options__option ${filterBy === "favourited" ? "active" : ""}`}
        onClick={() => onFilterChange("favourited")}
      >
        <span className="library-filter-options__label">
          {t("Favourite Games")}
        </span>
        <span className="library-filter-options__count">{favouritedCount}</span>
      </button>
      <button
        className={`library-filter-options__option ${filterBy === "new" ? "active" : ""}`}
        onClick={() => onFilterChange("new")}
      >
        <span className="library-filter-options__label">{t("new_games")}</span>
        <span className="library-filter-options__count">{newGamesCount}</span>
      </button>
      <button
        className={`library-filter-options__option ${filterBy === "top10" ? "active" : ""}`}
        onClick={() => onFilterChange("top10")}
      >
        <span className="library-filter-options__label">
          {t("Most Played")}
        </span>
        <span className="library-filter-options__count">{top10Count}</span>
      </button>
    </div>
  );
}
