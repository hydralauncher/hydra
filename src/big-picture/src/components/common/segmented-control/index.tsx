import "./styles.scss";

import cn from "classnames";
import { useId, useMemo, type ReactNode } from "react";

import type { FocusOverrides } from "../../../services";
import { useNavigationIsFocused } from "../../../stores";
import { useNavigationScreenActions } from "../../../hooks/use-navigation-screen-actions.hook";
import type { ScreenActions } from "../../../types";
import { FocusItem } from "../focus-item";

export interface SegmentedControlOption<TValue extends string = string> {
  value: TValue;
  label: ReactNode;
}

export interface SegmentedControlProps<TValue extends string = string> {
  label?: string;
  ariaLabel?: string;
  value: TValue;
  options: SegmentedControlOption<TValue>[];
  disabled?: boolean;
  focusId: string;
  navigationOrder?: number;
  navigationOverrides?: FocusOverrides;
  onValueChange: (value: TValue) => void;
}

const NO_SCREEN_ACTIONS: ScreenActions = {};

export function SegmentedControl<TValue extends string = string>({
  label,
  ariaLabel,
  value,
  options,
  disabled = false,
  focusId,
  navigationOrder,
  navigationOverrides,
  onValueChange,
}: Readonly<SegmentedControlProps<TValue>>) {
  const labelId = useId();
  const isFocused = useNavigationIsFocused(focusId);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const hasPrevious = selectedIndex > 0;
  const hasNext = selectedIndex < options.length - 1;

  const select = (index: number) => {
    const option = options[index];
    if (!option || disabled || option.value === value) return;
    onValueChange(option.value);
  };

  const screenActions = useMemo<ScreenActions>(() => {
    if (!isFocused || disabled) return NO_SCREEN_ACTIONS;

    return {
      direction: {
        ...(hasPrevious
          ? { left: () => onValueChange(options[selectedIndex - 1].value) }
          : {}),
        ...(hasNext
          ? { right: () => onValueChange(options[selectedIndex + 1].value) }
          : {}),
      },
    };
  }, [
    disabled,
    hasNext,
    hasPrevious,
    isFocused,
    onValueChange,
    options,
    selectedIndex,
  ]);

  useNavigationScreenActions(screenActions);

  const selectNextWrapping = () => {
    if (options.length < 2) return;
    select((selectedIndex + 1) % options.length);
  };

  return (
    <div
      className={cn("segmented-control", {
        "segmented-control--disabled": disabled,
      })}
    >
      {label ? (
        <span id={labelId} className="segmented-control__label">
          {label}
        </span>
      ) : null}

      <FocusItem
        id={focusId}
        navigationState={disabled ? "disabled" : "active"}
        navigationOrder={navigationOrder}
        navigationOverrides={navigationOverrides}
        actions={{ primary: selectNextWrapping }}
        asChild
      >
        <div
          className="segmented-control__track"
          role="radiogroup"
          tabIndex={-1}
          aria-labelledby={label ? labelId : undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-disabled={disabled}
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;

            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                tabIndex={-1}
                aria-checked={isSelected}
                disabled={disabled}
                className={cn("segmented-control__option", {
                  "segmented-control__option--selected": isSelected,
                })}
                onClick={() => select(index)}
              >
                <span className="segmented-control__text">{option.label}</span>
              </button>
            );
          })}
        </div>
      </FocusItem>
    </div>
  );
}
