import { useTranslation } from "react-i18next";
import { SelectField } from "@renderer/components";
import "./filter-options.scss";

export type SortOption =
  | "title_asc"
  | "recently_played"
  | "most_played"
  | "installed_first"
  | "title_desc";

interface FilterOptionsProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
}

export function FilterOptions({
  sortBy,
  onSortChange,
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
    </div>
  );
}
