import { useTranslation } from "react-i18next";
import { FlameIcon, HistoryIcon } from "@primer/octicons-react";
import cn from "classnames";

import type { ScreenshotSort } from "@types";

interface SegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: typeof HistoryIcon;
}

interface SegmentedToggleProps<Value extends string> {
  label: string;
  value: Value;
  options: SegmentedOption<Value>[];
  onChange: (value: Value) => void;
}

function SegmentedToggle<Value extends string>({
  label,
  value,
  options,
  onChange,
}: Readonly<SegmentedToggleProps<Value>>) {
  return (
    <fieldset className="game-screenshots-modal__sort" aria-label={label}>
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          className={cn("game-screenshots-modal__sort-option", {
            "game-screenshots-modal__sort-option--active":
              value === optionValue,
          })}
          aria-pressed={value === optionValue}
          onClick={() => {
            if (optionValue !== value) onChange(optionValue);
          }}
        >
          {Icon ? <Icon size={14} /> : null}
          {optionLabel}
        </button>
      ))}
    </fieldset>
  );
}

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
    <SegmentedToggle
      label={t("sort_by")}
      value={sort}
      options={[
        { value: "recent", label: t("sort_recent"), icon: HistoryIcon },
        { value: "top", label: t("sort_top"), icon: FlameIcon },
      ]}
      onChange={onChange}
    />
  );
}
