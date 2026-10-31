import { useId } from "react";
import cn from "classnames";

export interface ReviewSegmentedOption<T extends string> {
  value: T;
  label: string;
  addon?: React.ReactNode;
  isLocked?: boolean;
}

interface ReviewSegmentedControlProps<T extends string> {
  label: string;
  options: ReviewSegmentedOption<T>[];
  value: T;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function ReviewSegmentedControl<T extends string>({
  label,
  options,
  value,
  disabled = false,
  onChange,
}: Readonly<ReviewSegmentedControlProps<T>>) {
  const labelId = useId();
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );

  return (
    <div className="screenshot-review-segmented">
      <span id={labelId} className="screenshot-review-segmented__label">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        className={cn("screenshot-review-segmented__track", {
          "screenshot-review-segmented__track--disabled": disabled,
        })}
        style={
          {
            "--segment-count": options.length,
            "--segment-index": selectedIndex,
          } as React.CSSProperties
        }
      >
        <span
          className="screenshot-review-segmented__indicator"
          aria-hidden="true"
        />
        {options.map((option) => {
          const isSelected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={disabled}
              className={cn("screenshot-review-segmented__segment", {
                "screenshot-review-segmented__segment--selected": isSelected,
                "screenshot-review-segmented__segment--locked": option.isLocked,
              })}
              onClick={() => onChange(option.value)}
            >
              <span className="screenshot-review-segmented__segment-label">
                {option.label}
              </span>
              {option.addon}
            </button>
          );
        })}
      </div>
    </div>
  );
}
