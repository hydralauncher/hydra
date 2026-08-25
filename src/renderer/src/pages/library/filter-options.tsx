import { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  SortAscIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@primer/octicons-react";
import "./filter-options.scss";

export type SortOption =
  | "title_asc"
  | "recently_played"
  | "most_played"
  | "achievements"
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
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const getLabel = useCallback(
    (key: string) => {
      switch (key) {
        case "sort_title_asc":
          return t("sort_title_asc", { defaultValue: "Título (A-Z)" });
        case "recently_played":
        case "sort_recently_played":
          return t("recently_played", {
            defaultValue: "Jogados recentemente",
          });
        case "sort_most_played":
          return t("sort_most_played", { defaultValue: "Mais jogados" });
        case "sort_achievements":
          return t("sort_achievements", { defaultValue: "Conquistas" });
        case "sort_installed_first":
          return t("sort_installed_first", {
            defaultValue: "Instalados primeiro",
          });
        case "sort_title_desc":
          return t("sort_title_desc", { defaultValue: "Título (Z-A)" });
        default:
          return t(key);
      }
    },
    [t]
  );

  const options: { value: SortOption; labelKey: string }[] = [
    { value: "title_asc", labelKey: "sort_title_asc" },
    { value: "recently_played", labelKey: "recently_played" },
    { value: "most_played", labelKey: "sort_most_played" },
    { value: "achievements", labelKey: "sort_achievements" },
    { value: "installed_first", labelKey: "sort_installed_first" },
    { value: "title_desc", labelKey: "sort_title_desc" },
  ];

  const activeOption = options.find((o) => o.value === sortBy);
  const activeLabel = activeOption
    ? getLabel(activeOption.labelKey)
    : getLabel("recently_played");

  const handleSelect = useCallback(
    (value: SortOption) => {
      onSortChange(value);
      setOpen(false);
    },
    [onSortChange]
  );

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className="library-filter-options" ref={containerRef}>
      <button
        type="button"
        className={`library-filter-options__trigger${open ? " library-filter-options__trigger--open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SortAscIcon size={14} className="library-filter-options__icon" />
        <span className="library-filter-options__label">{activeLabel}</span>
        <ChevronDownIcon
          size={12}
          className={`library-filter-options__chevron${open ? " library-filter-options__chevron--open" : ""}`}
        />
      </button>

      {open && (
        <ul
          className="library-filter-options__dropdown"
          role="listbox"
          aria-label={t("sort_by", { defaultValue: "Ordenar por" })}
        >
          {options.map(({ value, labelKey }) => (
            <li
              key={value}
              role="option"
              aria-selected={sortBy === value}
              tabIndex={0}
              className={`library-filter-options__option${sortBy === value ? " library-filter-options__option--active" : ""}`}
              onClick={() => handleSelect(value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleSelect(value);
              }}
            >
              <span>{getLabel(labelKey)}</span>
              {sortBy === value && (
                <CheckIcon
                  size={12}
                  className="library-filter-options__check"
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
