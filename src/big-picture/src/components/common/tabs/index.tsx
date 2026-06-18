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
import { useGamepad } from "../../../hooks";
import { NavigationAudioService, type FocusOverrides } from "../../../services";
import { useNavigationIsFocused } from "../../../stores";
import { GamepadButtonType } from "../../../types";

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
  itemsFocusable?: boolean;
  manageFocusRegion?: boolean;
  selectOnFocus?: boolean;
  ignoreInitialFocusSelection?: boolean;
  animateSegmentedIndicator?: boolean;
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
        id={resolvedId}
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

function NonFocusableTabsButton<TValue extends string = string>({
  item,
  resolvedId,
  isSelected,
  variant,
  onSelect,
}: Readonly<
  Omit<
    TabsButtonProps<TValue>,
    "navigationOrder" | "selectOnFocus" | "ignoreInitialFocusSelection"
  >
>) {
  return (
    <button
      id={resolvedId}
      type="button"
      role="tab"
      tabIndex={-1}
      aria-selected={isSelected}
      disabled={item.disabled}
      className={cn("tabs__tab", {
        "tabs__tab--segmented": variant === "segmented",
        "tabs__tab--settings": variant === "settings",
        "tabs__tab--active": isSelected,
        "tabs__tab--disabled": item.disabled,
      })}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
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
    </button>
  );
}

export function Tabs<TValue extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
  itemsFocusable = true,
  manageFocusRegion = true,
  selectOnFocus = true,
  ignoreInitialFocusSelection = false,
  animateSegmentedIndicator = true,
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
  const [indicatorStyle, setIndicatorStyle] = useState<{
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

  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();

  const findNextEnabledIndex = useCallback(
    (fromIndex: number, direction: 1 | -1): number => {
      let i = fromIndex + direction;

      while (i >= 0 && i < resolvedItems.length && resolvedItems[i]?.disabled) {
        i += direction;
      }

      return i >= 0 && i < resolvedItems.length ? i : -1;
    },
    [resolvedItems]
  );

  useEffect(() => {
    if (variant === "settings") return;

    const removeLeftBumper = onButtonPressed(
      GamepadButtonType.LEFT_BUMPER,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        const currentIndex = resolvedItems.findIndex(
          (item) => item.value === selectedValue
        );

        if (currentIndex <= 0) return;

        const nextIndex = findNextEnabledIndex(currentIndex, -1);

        if (nextIndex === -1) return;

        const nextItem = resolvedItems[nextIndex];

        if (!nextItem || nextItem.value === selectedValue) return;

        handleSelect(nextItem.value);
        NavigationAudioService.getInstance().play("scroll");
      }
    );

    const removeRightBumper = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      (event) => {
        if (!isActiveGamepadEvent(event)) return;

        const currentIndex = resolvedItems.findIndex(
          (item) => item.value === selectedValue
        );

        if (currentIndex < 0 || currentIndex >= resolvedItems.length - 1)
          return;

        const nextIndex = findNextEnabledIndex(currentIndex, 1);

        if (nextIndex === -1) return;

        const nextItem = resolvedItems[nextIndex];

        if (!nextItem || nextItem.value === selectedValue) return;

        handleSelect(nextItem.value);
        NavigationAudioService.getInstance().play("scroll");
      }
    );

    return () => {
      removeLeftBumper();
      removeRightBumper();
    };
  }, [
    findNextEnabledIndex,
    handleSelect,
    isActiveGamepadEvent,
    onButtonPressed,
    resolvedItems,
    selectedValue,
    variant,
  ]);

  const updateIndicator = useCallback(() => {
    if (!selectedItem || variant === "settings") {
      setIndicatorStyle(null);
      return;
    }

    const tabList = tabListRef.current;

    if (!tabList) return;

    const activeTab = document.getElementById(selectedItem.resolvedId);

    if (!(activeTab instanceof HTMLElement) || !tabList.contains(activeTab)) {
      return;
    }

    setIndicatorStyle({
      x: activeTab.offsetLeft,
      width: activeTab.offsetWidth,
    });
  }, [selectedItem, variant]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    if (variant === "settings") return;

    const tabList = tabListRef.current;

    if (!tabList || typeof ResizeObserver === "undefined") return;

    const activeTab = selectedItem
      ? document.getElementById(selectedItem.resolvedId)
      : null;
    const resizeObserver = new ResizeObserver(() => {
      updateIndicator();
    });

    resizeObserver.observe(tabList);

    if (activeTab instanceof HTMLElement) {
      resizeObserver.observe(activeTab);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [selectedItem, updateIndicator, variant]);

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
                  "tabs__tablist--default": variant === "default",
                })}
              >
                {variant === "segmented" &&
                  indicatorStyle &&
                  (animateSegmentedIndicator ? (
                    <motion.span
                      className="tabs__segmented-indicator"
                      initial={false}
                      animate={{
                        x: indicatorStyle.x,
                        width: indicatorStyle.width,
                      }}
                      transition={{
                        type: "spring",
                        stiffness: 420,
                        damping: 34,
                        mass: 0.8,
                      }}
                    />
                  ) : (
                    <span
                      className="tabs__segmented-indicator"
                      style={
                        {
                          transform: `translateX(${indicatorStyle.x}px)`,
                          width: indicatorStyle.width,
                        } as CSSProperties
                      }
                    />
                  ))}

                {variant === "default" && indicatorStyle && (
                  <motion.span
                    className="tabs__indicator"
                    initial={false}
                    animate={{
                      x: indicatorStyle.x,
                      width: indicatorStyle.width,
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

                  if (!itemsFocusable) {
                    return (
                      <NonFocusableTabsButton
                        key={item.value}
                        item={item}
                        resolvedId={item.resolvedId}
                        isSelected={isSelected}
                        variant={variant}
                        onSelect={handleSelect}
                      />
                    );
                  }

                  return (
                    <FocusableTabsButton
                      key={item.value}
                      item={item}
                      resolvedId={item.resolvedId}
                      navigationOrder={index}
                      isSelected={isSelected}
                      variant={variant}
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
