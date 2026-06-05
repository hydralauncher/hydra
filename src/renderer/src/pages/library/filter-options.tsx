import { useTranslation } from "react-i18next";
import { SelectField } from "@renderer/components";
import "./filter-options.scss";

export type SortOption =
  | "title_asc"
  | "recently_played"
  | "most_played"
  | "installed_first"
  | "title_desc";

export type SourceFilter = "all" | "steam" | "hydra";

interface FilterOptionsProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (source: SourceFilter) => void;
}

export function FilterOptions({
  sortBy,
  onSortChange,
  sourceFilter,
  onSourceFilterChange,
}: Readonly<FilterOptionsProps>) {
  const { t } = useTranslation("library");

  return (
    <div className="library-filter-options__container">
      <span className="library-filter-options__label">{t("sort_by")}</span>
      <SelectField
        className="library-filter-options__select"
        value={sortBy}
        onChange={(event) => onSortChange(event.target.value as SortOption)}
        options={[
          {
            key: "title-asc",
            value: "title_asc",
            label: t("sort_title_asc"),
          },
          {
            key: "recently-played",
            value: "recently_played",
            label: t("recently_played"),
          },
          {
            key: "most-played",
            value: "most_played",
            label: t("sort_most_played"),
          },
          {
            key: "installed-first",
            value: "installed_first",
            label: t("sort_installed_first"),
          },
          {
            key: "title-desc",
            value: "title_desc",
            label: t("sort_title_desc"),
          },
        ]}
      />

      <span className="library-filter-options__label">{t("source")}</span>
      <SelectField
        className="library-filter-options__select"
        value={sourceFilter}
        onChange={(event) =>
          onSourceFilterChange(event.target.value as SourceFilter)
        }
        options={[
          { key: "all", value: "all", label: t("source_all") },
          { key: "steam", value: "steam", label: t("source_steam") },
          { key: "hydra", value: "hydra", label: t("source_hydra") },
        ]}
      />
    </div>
  );
}
