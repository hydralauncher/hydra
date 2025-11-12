import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import "./filter-options.scss";

export type FilterOption = "all" | "recently_played" | "favorites";

interface FilterOptionsProps {
  filterBy: FilterOption;
  onFilterChange: (filterBy: FilterOption) => void;
  allGamesCount: number;
  recentlyPlayedCount: number;
  favoritesCount: number;
}

export function FilterOptions({
  filterBy,
  onFilterChange,
  allGamesCount,
  recentlyPlayedCount,
  favoritesCount,
}: Readonly<FilterOptionsProps>) {
  const { t } = useTranslation("library");

  return (
    <div className="library-filter-options__tabs">
      <div className="library-filter-options__tab-wrapper">
        <button
          type="button"
          className={`library-filter-options__tab ${filterBy === "all" ? "library-filter-options__tab--active" : ""}`}
          onClick={() => onFilterChange("all")}
        >
          {t("all_games")}
          {allGamesCount > 0 && (
            <span className="library-filter-options__tab-badge">
              {allGamesCount}
            </span>
          )}
        </button>
        {filterBy === "all" && (
          <motion.div
            className="library-filter-options__tab-underline"
            layoutId="library-tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
      <div className="library-filter-options__tab-wrapper">
        <button
          type="button"
          className={`library-filter-options__tab ${filterBy === "recently_played" ? "library-filter-options__tab--active" : ""}`}
          onClick={() => onFilterChange("recently_played")}
        >
          {t("recently_played")}
          {recentlyPlayedCount > 0 && (
            <span className="library-filter-options__tab-badge">
              {recentlyPlayedCount}
            </span>
          )}
        </button>
        {filterBy === "recently_played" && (
          <motion.div
            className="library-filter-options__tab-underline"
            layoutId="library-tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
      <div className="library-filter-options__tab-wrapper">
        <button
          type="button"
          className={`library-filter-options__tab ${filterBy === "favorites" ? "library-filter-options__tab--active" : ""}`}
          onClick={() => onFilterChange("favorites")}
        >
          {t("favorites")}
          {favoritesCount > 0 && (
            <span className="library-filter-options__tab-badge">
              {favoritesCount}
            </span>
          )}
        </button>
        {filterBy === "favorites" && (
          <motion.div
            className="library-filter-options__tab-underline"
            layoutId="library-tab-underline"
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
          />
        )}
      </div>
    </div>
  );
}
