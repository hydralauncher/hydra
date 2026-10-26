import { useTranslation } from "react-i18next";
import {
  DownloadIcon,
  HistoryIcon,
  HourglassIcon,
  SortDescIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import { LibrarySelect } from "./library-select";
import "./filter-options.scss";

export type SortOption =
  | "title_asc"
  | "recently_played"
  | "most_played"
  | "achievements"
  | "installed_first";

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
          {
            value: "title_asc",
            label: t("sort_title"),
            icon: <SortDescIcon size={14} />,
          },
          {
            value: "recently_played",
            label: t("recently_played"),
            icon: <HistoryIcon size={14} />,
          },
          {
            value: "most_played",
            label: t("sort_most_played"),
            icon: <HourglassIcon size={14} />,
          },
          {
            value: "achievements",
            label: t("sort_achievements"),
            icon: <TrophyIcon size={14} />,
          },
          {
            value: "installed_first",
            label: t("sort_installed_first"),
            icon: <DownloadIcon size={14} />,
          },
        ]}
      />
    </div>
  );
}
