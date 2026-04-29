import "./styles.scss";

import { motion } from "framer-motion";
import cn from "classnames";
import {
  type CSSProperties,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from "react";
import { FocusItem } from "../focus-item";
import { HorizontalFocusGroup } from "../horizontal-focus-group";
import type { FocusOverrides } from "../../../services";

export interface TabsItem<TValue extends string = string> {
  id?: string;
  value: TValue;
  label: ReactNode;
  disabled?: boolean;
  navigationOverrides?: FocusOverrides;
}

export interface TabsProps<TValue extends string = string> {
  items: Array<TabsItem<TValue>>;
  value?: TValue;
  defaultValue?: TValue;
  onValueChange?: (value: TValue) => void;
  /** Inline after tab buttons, same row and focus region (e.g. add action). */
  afterTabs?: ReactNode;
  trailingAction?: ReactNode;
  regionId?: string;
  navigationOverrides?: FocusOverrides;
  ariaLabel?: string;
  className?: string;
}

export function Tabs<TValue extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
  afterTabs,
  trailingAction,
  regionId,
  navigationOverrides,
  ariaLabel = "Tabs",
  className,
}: Readonly<TabsProps<TValue>>) {
  const generatedId = useId();
  const [internalValue, setInternalValue] = useState<TValue | undefined>(
    defaultValue ?? items[0]?.value
  );
  const selectedValue = value ?? internalValue;
  const indicatorLayoutId = `tabs-indicator-${generatedId}`;

  const selectedItem = useMemo(
    () => items.find((item) => item.value === selectedValue),
    [items, selectedValue]
  );

  const handleSelect = (nextValue: TValue) => {
    setInternalValue(nextValue);
    onValueChange?.(nextValue);
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className={cn("tabs", className)}>
      <div className="tabs__content">
        <HorizontalFocusGroup
          regionId={regionId}
          navigationOverrides={navigationOverrides}
          autoScrollMode="region"
          className="tabs__list"
          style={
            {
              gap: "calc(var(--spacing-unit) * 12)",
              alignItems: "flex-start",
              flexWrap: "nowrap",
            } as CSSProperties
          }
        >
          <div role="tablist" aria-label={ariaLabel} className="tabs__tablist">
            {items.map((item) => {
              const isSelected = selectedItem?.value === item.value;

              return (
                <FocusItem
                  key={item.value}
                  id={item.id}
                  asChild
                  navigationState={item.disabled ? "disabled" : "active"}
                  navigationOverrides={item.navigationOverrides}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    disabled={item.disabled}
                    className={cn("tabs__tab", {
                      "tabs__tab--active": isSelected,
                      "tabs__tab--disabled": item.disabled,
                    })}
                    onClick={() => handleSelect(item.value)}
                  >
                    <span className="tabs__tab-label">{item.label}</span>

                    {isSelected && (
                      <motion.span
                        className="tabs__indicator"
                        layoutId={indicatorLayoutId}
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 34,
                          mass: 0.8,
                        }}
                      />
                    )}
                  </button>
                </FocusItem>
              );
            })}
          </div>

          {afterTabs}
        </HorizontalFocusGroup>

        {trailingAction && (
          <div className="tabs__trailing-action">{trailingAction}</div>
        )}
      </div>

      <div className="tabs__divider" aria-hidden="true" />
    </div>
  );
}
