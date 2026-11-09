import type { Icon } from "@primer/octicons-react";
import cn from "classnames";

import "./screenshot-segmented-toggle.scss";

export interface ScreenshotSegmentedOption<Value extends string> {
  value: Value;
  label: string;
  icon?: Icon;
}

interface ScreenshotSegmentedToggleProps<Value extends string> {
  label: string;
  value: Value;
  options: ScreenshotSegmentedOption<Value>[];
  className?: string;
  onChange: (value: Value) => void;
}

export function ScreenshotSegmentedToggle<Value extends string>({
  label,
  value,
  options,
  className,
  onChange,
}: Readonly<ScreenshotSegmentedToggleProps<Value>>) {
  return (
    <fieldset
      className={cn("screenshot-segmented-toggle", className)}
      aria-label={label}
    >
      {options.map(({ value: optionValue, label: optionLabel, icon: Icon }) => (
        <button
          key={optionValue}
          type="button"
          className={cn("screenshot-segmented-toggle__option", {
            "screenshot-segmented-toggle__option--active":
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
