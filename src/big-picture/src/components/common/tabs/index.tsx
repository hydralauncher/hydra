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
  onSelect: (value: TValue) => void;
  labelRef?: (node: HTMLSpanElement | null) => void;
}

function FocusableTabsButton<TValue extends string = string>({
  item,
  resolvedId,
  navigationOrder,
  isSelected,
  variant,
  indicatorLayoutId,
  onSelect,
  labelRef,
}: Readonly<TabsButtonProps<TValue>>) {
  const isFocused = useNavigationIsFocused(resolvedId);
  const wasFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocused && !wasFocusedRef.current && !item.disabled && !isSelected) {
      onSelect(item.value);
    }

    wasFocusedRef.current = isFocused;
  }, [isFocused, isSelected, item.disabled, item.value, onSelect]);

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
            <span ref={labelRef} className="tabs__tab-label-text">
              {item.label}
            </span>
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

export function Tabs<TValue extends string = string>({
  items,
  value,
  defaultValue,
  onValueChange,
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
  const [settingsIndicatorStyle, setSettingsIndicatorStyle] = useState<{
    x: number;
    width: number;
  } | null>(null);
  const selectedValue = value ?? internalValue;
  const indicatorLayoutId = `tabs-indicator-${generatedId}`;
  const settingsLabelRefs = useRef(new Map<TValue, HTMLSpanElement>());
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

  const updateSettingsIndicator = useCallback(() => {
    if (variant !== "settings" || !selectedItem) {
      setSettingsIndicatorStyle(null);
      return;
    }

    const tabList = tabListRef.current;
    const activeLabel = settingsLabelRefs.current.get(selectedItem.value);

    if (
      !(tabList instanceof HTMLElement) ||
      !(activeLabel instanceof HTMLElement)
    ) {
      setSettingsIndicatorStyle(null);
      return;
    }

    const tabListRect = tabList.getBoundingClientRect();
    const labelRect = activeLabel.getBoundingClientRect();

    setSettingsIndicatorStyle({
      x: labelRect.left - tabListRect.left,
      width: labelRect.width,
    });
  }, [selectedItem, variant]);

  const createSettingsLabelRef = useCallback(
    (value: TValue) => (node: HTMLSpanElement | null) => {
      if (node) {
        settingsLabelRefs.current.set(value, node);
        return;
      }

      settingsLabelRefs.current.delete(value);
    },
    []
  );

  useLayoutEffect(() => {
    updateSegmentedIndicator();
  }, [updateSegmentedIndicator]);

  useLayoutEffect(() => {
    updateSettingsIndicator();
  }, [updateSettingsIndicator]);

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

  useEffect(() => {
    if (variant !== "settings") return;

    const tabList = tabListRef.current;
    const activeLabel = selectedItem
      ? settingsLabelRefs.current.get(selectedItem.value)
      : null;

    if (
      !(tabList instanceof HTMLElement) ||
      !(activeLabel instanceof HTMLElement) ||
      typeof ResizeObserver === "undefined"
    ) {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateSettingsIndicator();
    });

    resizeObserver.observe(tabList);
    resizeObserver.observe(activeLabel);

    return () => {
      resizeObserver.disconnect();
    };
  }, [selectedItem, updateSettingsIndicator, variant]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className={cn("tabs", className, {
        "tabs--segmented": variant === "segmented",
        "tabs--settings": variant === "settings",
      })}
    >
      <div className="tabs__content">
        <HorizontalFocusGroup
          regionId={regionId}
          navigationOverrides={navigationOverrides}
          autoScrollMode="region"
          className={cn("tabs__list", {
            "tabs__list--segmented": variant === "segmented",
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

            {beforeTabs && <div className="tabs__before-tabs">{beforeTabs}</div>}

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
                  onSelect={handleSelect}
                  labelRef={
                    variant === "settings"
                      ? createSettingsLabelRef(item.value)
                      : undefined
                  }
                />
              );
            })}

            {afterTabs && <div className="tabs__after-tabs">{afterTabs}</div>}

            {variant === "settings" && settingsIndicatorStyle && (
              <motion.span
                className="tabs__settings-indicator"
                initial={false}
                animate={{
                  x: settingsIndicatorStyle.x,
                  width: settingsIndicatorStyle.width,
                }}
                transition={{
                  type: "spring",
                  stiffness: 420,
                  damping: 34,
                  mass: 0.8,
                }}
              />
            )}
          </div>
        </HorizontalFocusGroup>

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
