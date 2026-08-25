import { useRef, useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  SortAscIcon,
  ChevronDownIcon,
  CheckIcon,
} from "@primer/octicons-react";
import "./sort-options.scss";

type SortOption = "playtime" | "achievementCount" | "playedRecently";

interface SortOptionsProps {
  sortBy: SortOption;
  onSortChange: (sortBy: SortOption) => void;
}

export function SortOptions({
  sortBy,
  onSortChange,
}: Readonly<SortOptionsProps>) {
  const { t } = useTranslation("user_profile");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options: { value: SortOption; labelKey: string }[] = [
    { value: "achievementCount", labelKey: "achievements_earned" },
    { value: "playedRecently", labelKey: "played_recently" },
    { value: "playtime", labelKey: "playtime" },
  ];

  const activeLabel =
    options.find((o) => o.value === sortBy)?.labelKey ?? "played_recently";

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
    <div className="profile-sort-options" ref={containerRef}>
      <button
        type="button"
        className={`profile-sort-options__trigger${open ? " profile-sort-options__trigger--open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <SortAscIcon size={14} className="profile-sort-options__icon" />
        <span className="profile-sort-options__label">{t(activeLabel)}</span>
        <ChevronDownIcon
          size={12}
          className={`profile-sort-options__chevron${open ? " profile-sort-options__chevron--open" : ""}`}
        />
      </button>

      {open && (
        <ul
          className="profile-sort-options__dropdown"
          role="listbox"
          aria-label={t("sort_by")}
        >
          {options.map(({ value, labelKey }) => (
            <li
              key={value}
              role="option"
              aria-selected={sortBy === value}
              tabIndex={0}
              className={`profile-sort-options__option${sortBy === value ? " profile-sort-options__option--active" : ""}`}
              onClick={() => handleSelect(value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") handleSelect(value);
              }}
            >
              <span>{t(labelKey)}</span>
              {sortBy === value && (
                <CheckIcon size={12} className="profile-sort-options__check" />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
