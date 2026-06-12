import "./styles.scss";

import { motion } from "framer-motion";
import cn from "classnames";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FocusItem } from "../focus-item";
import { HorizontalFocusGroup } from "../horizontal-focus-group";
import type { FocusOverrides } from "../../../services";
import { useNavigationIsFocused } from "../../../stores";

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
  manageFocusRegion?: boolean;
  selectOnFocus?: boolean;
  ignoreInitialFocusSelection?: boolean;
  variant?: "default" | "segmented" | "settings";
  beforeTabs?: ReactNode;
  afterTabs?: ReactNode;
  trailingAction?: ReactNode;
  regionId?: string;
  navigationOverrides?: FocusOverrides;
  ariaLabel?: string;
  className?: string;
}

interface TabsButtonProps<TValue extends string = string> {
  item: TabsItem<TValue>;
  resolvedId: string;
  navigationOrder: number;
  isSelected: boolean;
  variant: "default" | "segmented" | "settings";
  indicatorLayoutId: string;
  selectOnFocus: boolean;
  ignoreInitialFocusSelection: boolean;
  onSelect: (value: TValue) => void;
}

function FocusableTabsButton<TValue extends string = string>({
  item,
  resolvedId,
  navigationOrder,
  isSelected,
  variant,
  indicatorLayoutId,
  selectOnFocus,
  ignoreInitialFocusSelection,
  onSelect,
}: Readonly<TabsButtonProps<TValue>>) {
  const isFocused = useNavigationIsFocused(resolvedId);
  const wasFocusedRef = useRef(false);
  const hasHandledInitialFocusRef = useRef(false);

  useEffect(() => {
    const isNewFocus = isFocused && !wasFocusedRef.current;
    const shouldIgnoreSelection =
      selectOnFocus &&
      ignoreInitialFocusSelection &&
      !hasHandledInitialFocusRef.current &&
      isNewFocus &&
      !item.disabled &&
      !isSelected;

    if (
      selectOnFocus &&
      isNewFocus &&
      !item.disabled &&
      !isSelected &&
      !shouldIgnoreSelection
    ) {
      onSelect(item.value);
    }

    wasFocusedRef.current = isFocused;
    hasHandledInitialFocusRef.current = true;
  }, [
    ignoreInitialFocusSelection,
    isFocused,
    isSelected,
    item.disabled,
    item.value,
    onSelect,
    selectOnFocus,
  ]);

  return (
    <FocusItem
      id={resolvedId}
      asChild
      navigationState={item.disabled ? "disabled" : "active"}
      navigationOrder={navigationOrder}
      navigationOverrides={item.navigationOverrides}
    >
      <button
        type="button"
        role="tab"
        aria-selected={isSelected}
        disabled={item.disabled}
        className={cn("tabs__tab", {
          "tabs__tab--segmented": variant === "segmented",
          "tabs__tab--settings": variant === "settings",
          "tabs__tab--active": isSelected,
          "tabs__tab--disabled": item.disabled,
        })}
        onClick={() => onSelect(item.value)}
      >
        <span
          className={cn("tabs__tab-label", {
            "tabs__tab-label--segmented": variant === "segmented",
            "tabs__tab-label--settings": variant === "settings",
          })}
        >
          {variant === "settings" ? (
            <span className="tabs__tab-label-text">{item.label}</span>
          ) : (
            item.label
          )}
        </span>

        {isSelected && variant === "default" && (
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
}

interface SettingsTabsButtonProps<TValue extends string = string> {
  item: TabsItem<TValue>;
  isSelected: boolean;
  indicatorLayoutId: string;
  onSelect: (value: TValue) => void;
}

function SettingsTabsButton<TValue extends string = string>({
  item,
  isSelected,
  indicatorLayoutId,
  onSelect,
}: Readonly<SettingsTabsButtonProps<TValue>>) {
  return (
    <button
      type="button"
      role="tab"
      tabIndex={-1}
      aria-selected={isSelected}
      disabled={item.disabled}
      className={cn("tabs__tab", {
        "tabs__tab--settings": true,
        "tabs__tab--active": isSelected,
        "tabs__tab--disabled": item.disabled,
      })}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => onSelect(item.value)}
    >
      <span className="tabs__tab-label tabs__tab-label--settings">
        <span className="tabs__tab-label-text">{item.label}</span>
      </span>

      {isSelected && (
        <motion.span
          className="tabs__settings-indicator"
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
  );
}

export function Tabs<TValue extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
  manageFocusRegion = true,
  selectOnFocus = true,
  ignoreInitialFocusSelection = false,
  variant = "default",
  beforeTabs,
  afterTabs,
  trailingAction,
  regionId,
  navigationOverrides,
  ariaLabel = "Tabs",
  className,
}: Readonly<TabsProps<TValue>>) {
  const generatedId = useId();
  const tabListRef = useRef<HTMLDivElement | null>(null);
  const [internalValue, setInternalValue] = useState<TValue | undefined>(
    defaultValue ?? items[0]?.value
  );
  const [segmentedIndicatorStyle, setSegmentedIndicatorStyle] = useState<{
    x: number;
    width: number;
  } | null>(null);
  const selectedValue = value ?? internalValue;
  const indicatorLayoutId = `tabs-indicator-${generatedId}`;
  const resolvedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        resolvedId:
          item.id ??
          `tabs-item-${generatedId.replaceAll(":", "")}-${item.value}`,
      })),
    [generatedId, items]
  );

  const selectedItem = useMemo(
    () => resolvedItems.find((item) => item.value === selectedValue),
    [resolvedItems, selectedValue]
  );

  const handleSelect = useCallback(
    (nextValue: TValue) => {
      setInternalValue(nextValue);
      onValueChange?.(nextValue);
    },
    [onValueChange]
  );

  const updateSegmentedIndicator = useCallback(() => {
    if (variant !== "segmented" || !selectedItem) {
      setSegmentedIndicatorStyle(null);
      return;
    }

    const tabList = tabListRef.current;

    if (!tabList) return;

    const activeTab = document.getElementById(selectedItem.resolvedId);

    if (!(activeTab instanceof HTMLElement) || !tabList.contains(activeTab)) {
      return;
    }

    setSegmentedIndicatorStyle({
      x: activeTab.offsetLeft,
      width: activeTab.offsetWidth,
    });
  }, [selectedItem, variant]);

  useLayoutEffect(() => {
    updateSegmentedIndicator();
  }, [updateSegmentedIndicator]);

  useEffect(() => {
    if (variant !== "segmented") return;

    const tabList = tabListRef.current;

    if (!tabList || typeof ResizeObserver === "undefined") return;

    const activeTab = selectedItem
      ? document.getElementById(selectedItem.resolvedId)
      : null;
    const resizeObserver = new ResizeObserver(() => {
      updateSegmentedIndicator();
    });

    resizeObserver.observe(tabList);

    if (activeTab instanceof HTMLElement) {
      resizeObserver.observe(activeTab);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [selectedItem, updateSegmentedIndicator, variant]);

  if (items.length === 0) {
    return null;
  }

  const tabsListClassName = cn("tabs__list", {
    "tabs__list--segmented": variant === "segmented",
  });
  const tabsListStyle = {
    gap: "calc(var(--spacing-unit) * 12)",
    alignItems: "flex-start",
    flexWrap: "nowrap",
  } as CSSProperties;

  return (
    <div
      className={cn("tabs", className, {
        "tabs--segmented": variant === "segmented",
        "tabs--settings": variant === "settings",
      })}
    >
      <div className="tabs__content">
        {variant === "settings" ? (
          <div
            className={cn("tabs__list", {
              "tabs__list--segmented": false,
            })}
            style={
              {
                gap: "calc(var(--spacing-unit) * 12)",
                alignItems: "flex-start",
                flexWrap: "nowrap",
              } as CSSProperties
            }
          >
            <div
              ref={tabListRef}
              role="tablist"
              aria-label={ariaLabel}
              className="tabs__tablist"
            >
              {beforeTabs && (
                <div className="tabs__before-tabs">{beforeTabs}</div>
              )}

              {resolvedItems.map((item) => {
                const isSelected = selectedItem?.value === item.value;

                return (
                  <SettingsTabsButton
                    key={item.value}
                    item={item}
                    isSelected={isSelected}
                    indicatorLayoutId={indicatorLayoutId}
                    onSelect={handleSelect}
                  />
                );
              })}

              {afterTabs && <div className="tabs__after-tabs">{afterTabs}</div>}
            </div>
          </div>
        ) : (
          (() => {
            const tabList = (
              <div
                ref={tabListRef}
                role="tablist"
                aria-label={ariaLabel}
                className={cn("tabs__tablist", {
                  "tabs__tablist--segmented": variant === "segmented",
                })}
              >
                {variant === "segmented" && segmentedIndicatorStyle && (
                  <motion.span
                    className="tabs__segmented-indicator"
                    initial={false}
                    animate={{
                      x: segmentedIndicatorStyle.x,
                      width: segmentedIndicatorStyle.width,
                    }}
                    transition={{
                      type: "spring",
                      stiffness: 420,
                      damping: 34,
                      mass: 0.8,
                    }}
                  />
                )}

                {beforeTabs && (
                  <div className="tabs__before-tabs">{beforeTabs}</div>
                )}

                {resolvedItems.map((item, index) => {
                  const isSelected = selectedItem?.value === item.value;

                  return (
                    <FocusableTabsButton
                      key={item.value}
                      item={item}
                      resolvedId={item.resolvedId}
                      navigationOrder={index}
                      isSelected={isSelected}
                      variant={variant}
                      indicatorLayoutId={indicatorLayoutId}
                      selectOnFocus={selectOnFocus}
                      ignoreInitialFocusSelection={ignoreInitialFocusSelection}
                      onSelect={handleSelect}
                    />
                  );
                })}

                {afterTabs && (
                  <div className="tabs__after-tabs">{afterTabs}</div>
                )}
              </div>
            );

            if (!manageFocusRegion) {
              return (
                <div className={tabsListClassName} style={tabsListStyle}>
                  {tabList}
                </div>
              );
            }

            return (
              <HorizontalFocusGroup
                regionId={regionId}
                navigationOverrides={navigationOverrides}
                autoScrollMode="region"
                className={tabsListClassName}
                style={tabsListStyle}
              >
                {tabList}
              </HorizontalFocusGroup>
            );
          })()
        )}

        {trailingAction && (
          <div className="tabs__trailing-action">{trailingAction}</div>
        )}
      </div>

      {variant === "default" && (
        <div className="tabs__divider" aria-hidden="true" />
      )}
    </div>
  );
}
