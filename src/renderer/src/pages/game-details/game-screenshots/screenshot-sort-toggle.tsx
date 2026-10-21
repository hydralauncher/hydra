import { useTranslation } from "react-i18next";
import { FlameIcon, HistoryIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { ScreenshotSort } from "@types";

const SORT_OPTIONS: { value: ScreenshotSort; icon: typeof HistoryIcon }[] = [
  { value: "recent", icon: HistoryIcon },
  { value: "top", icon: FlameIcon },
];

interface ScreenshotSortToggleProps {
  sort: ScreenshotSort;
  onChange: (sort: ScreenshotSort) => void;
}

export function ScreenshotSortToggle({
  sort,
  onChange,
}: Readonly<ScreenshotSortToggleProps>) {
  const { t } = useTranslation("screenshots");

  return (
    <fieldset
      className="game-screenshots-modal__sort"
      aria-label={t("sort_by")}
    >
      {SORT_OPTIONS.map(({ value, icon: Icon }) => (
        <button
          key={value}
          type="button"
          className={cn("game-screenshots-modal__sort-option", {
            "game-screenshots-modal__sort-option--active": sort === value,
          })}
          aria-pressed={sort === value}
          onClick={() => {
            if (value !== sort) onChange(value);
          }}
        >
          <Icon size={14} />
          {t(`sort_${value}`)}
        </button>
      ))}
    </fieldset>
  );
}
