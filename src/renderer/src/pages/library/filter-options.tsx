import { useTranslation } from "react-i18next";
import { LibrarySelect } from "./library-select";
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
      <LibrarySelect
        value={sortBy}
        ariaLabel={t("sort_by")}
        onChange={(value) => onSortChange(value as SortOption)}
        options={[
          { value: "title_asc", label: t("sort_title_asc") },
          { value: "recently_played", label: t("recently_played") },
          { value: "most_played", label: t("sort_most_played") },
          { value: "installed_first", label: t("sort_installed_first") },
          { value: "title_desc", label: t("sort_title_desc") },
        ]}
      />
    </div>
  );
}
