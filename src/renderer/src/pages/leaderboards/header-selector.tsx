import cn from "classnames";

import { useSelectorTooltip } from "../game-details/leaderboard/use-selector-tooltip";

export interface HeaderSelectorOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

export function HeaderSelector<T extends string>({
  label,
  showLabel = true,
  collapsible = false,
  options,
  value,
  onChange,
}: Readonly<{
  label: string;
  showLabel?: boolean;
  // Without room in the board header, the options only show their icons.
  collapsible?: boolean;
  options: HeaderSelectorOption<T>[];
  value: T;
  onChange: (value: T) => void;
}>) {
  const { showTooltip, hideTooltip, tooltipElement } = useSelectorTooltip();

  const showTooltipIfCollapsed = (option: HTMLElement, name: string) => {
    const optionLabel = option.querySelector(
      ".leaderboards__selector-option-label"
    );
    if (optionLabel?.getClientRects().length === 0) {
      showTooltip(option, name);
    }
  };

  return (
    <div
      className={cn("leaderboards__selector", {
        "leaderboards__selector--collapsible": collapsible,
      })}
    >
      {showLabel && (
        <span className="leaderboards__selector-label">{label}</span>
      )}
      <div
        className="leaderboards__selector-options"
        role="group"
        aria-label={label}
      >
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={option.id === value}
            aria-label={collapsible ? option.label : undefined}
            className={cn("leaderboards__selector-option", {
              "leaderboards__selector-option--selected": option.id === value,
            })}
            onMouseEnter={
              collapsible
                ? (event) =>
                    showTooltipIfCollapsed(event.currentTarget, option.label)
                : undefined
            }
            onMouseLeave={collapsible ? hideTooltip : undefined}
            onFocus={
              collapsible
                ? (event) => {
                    if (event.currentTarget.matches(":focus-visible")) {
                      showTooltipIfCollapsed(event.currentTarget, option.label);
                    }
                  }
                : undefined
            }
            onBlur={collapsible ? hideTooltip : undefined}
            onClick={() => onChange(option.id)}
          >
            {option.icon}
            <span className="leaderboards__selector-option-label">
              {option.label}
            </span>
          </button>
        ))}
      </div>
      {tooltipElement}
    </div>
  );
}
