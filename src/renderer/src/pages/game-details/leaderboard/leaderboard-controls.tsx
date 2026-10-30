import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import cn from "classnames";
import { GlobeIcon, PeopleIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { MetricIcon } from "@renderer/pages/leaderboards/metric-icon";

import {
  LEADERBOARD_PERIODS,
  LEADERBOARD_SCOPES,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "./game-leaderboard";

interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: Readonly<SegmentedControlProps<T>>) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      className="leaderboard-controls__segmented"
      style={
        {
          "--segment-count": options.length,
          "--segment-index": selectedIndex,
        } as React.CSSProperties
      }
    >
      <span className="leaderboard-controls__indicator" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          className={cn("leaderboard-controls__segment", {
            "leaderboard-controls__segment--selected": option.id === value,
          })}
          onClick={() => onChange(option.id)}
        >
          {option.icon}
          <span className="leaderboard-controls__segment-label">
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}

interface CardSelectorOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
}

interface CardSelectorProps<T extends string> {
  label: string;
  options: CardSelectorOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

interface SelectorTooltip {
  label: string;
  left: number;
  top: number;
  isNearEdge: boolean;
}

const TOOLTIP_GAP = 8;
// Closer than this to the window's edge, the tooltip aligns to the option's end.
const TOOLTIP_EDGE_DISTANCE = 72;

// The compact selector of the game page card. An option with an icon shows only
// the icon, and its name moves to a tooltip.
function CardSelector<T extends string>({
  label,
  options,
  value,
  onChange,
}: Readonly<CardSelectorProps<T>>) {
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === value)
  );
  const hasIcons = options.some((option) => option.icon);
  const [tooltip, setTooltip] = useState<SelectorTooltip | null>(null);
  const hideTooltip = useCallback(() => setTooltip(null), []);

  // The tooltip is fixed to the window, so scrolling would leave it behind.
  const isTooltipVisible = tooltip !== null;
  useEffect(() => {
    if (!isTooltipVisible) return;
    const options = { capture: true, passive: true };
    globalThis.addEventListener("scroll", hideTooltip, options);

    return () => globalThis.removeEventListener("scroll", hideTooltip, options);
  }, [hideTooltip, isTooltipVisible]);

  const showTooltip = (option: HTMLElement, label: string) => {
    const { left, right, top, width } = option.getBoundingClientRect();
    const isNearEdge = globalThis.innerWidth - right < TOOLTIP_EDGE_DISTANCE;

    setTooltip({
      label,
      isNearEdge,
      left: isNearEdge ? right : left + width / 2,
      top: top - TOOLTIP_GAP,
    });
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("leaderboard-controls__selector", {
        "leaderboard-controls__selector--icons": hasIcons,
      })}
      style={
        {
          "--segment-count": options.length,
          "--segment-index": selectedIndex,
        } as React.CSSProperties
      }
    >
      <span
        className="leaderboard-controls__selector-indicator"
        aria-hidden="true"
      />
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          aria-label={option.icon ? option.label : undefined}
          onMouseEnter={
            option.icon
              ? (event) => showTooltip(event.currentTarget, option.label)
              : undefined
          }
          onMouseLeave={hideTooltip}
          onFocus={
            option.icon
              ? (event) => {
                  if (event.currentTarget.matches(":focus-visible")) {
                    showTooltip(event.currentTarget, option.label);
                  }
                }
              : undefined
          }
          onBlur={hideTooltip}
          className={cn("leaderboard-controls__selector-option", {
            "leaderboard-controls__selector-option--selected":
              option.id === value,
          })}
          onClick={() => onChange(option.id)}
        >
          {option.icon ?? option.label}
        </button>
      ))}
      {tooltip &&
        createPortal(
          <span
            className={cn("leaderboard-controls__tooltip", {
              "leaderboard-controls__tooltip--near-edge": tooltip.isNearEdge,
            })}
            style={{ left: tooltip.left, top: tooltip.top }}
            aria-hidden="true"
          >
            {tooltip.label}
          </span>,
          document.body
        )}
    </div>
  );
}

export interface LeaderboardControlsProps {
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  metrics: readonly LeaderboardMetric[];
  showScope: boolean;
  showMetrics: boolean;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  onScopeChange: (scope: LeaderboardScope) => void;
  onMetricChange: (metric: LeaderboardMetric) => void;
}

const SCOPE_ICONS: Record<LeaderboardScope, React.ReactNode> = {
  global: <GlobeIcon size={14} />,
  friends: <PeopleIcon size={14} />,
};

export function LeaderboardControls({
  period,
  scope,
  metric,
  metrics,
  showScope,
  showMetrics,
  onPeriodChange,
  onScopeChange,
  onMetricChange,
}: Readonly<LeaderboardControlsProps>) {
  const { t } = useTranslation("leaderboard");

  return (
    <div className="leaderboard-controls">
      {showScope && (
        <CardSelector
          label={t("scope_label")}
          value={scope}
          onChange={onScopeChange}
          options={LEADERBOARD_SCOPES.map((id) => ({
            id,
            label: t(`scope_${id}`),
            icon: SCOPE_ICONS[id],
          }))}
        />
      )}

      <CardSelector
        label={t("period_label")}
        value={period}
        onChange={onPeriodChange}
        options={LEADERBOARD_PERIODS.map((id) => ({
          id,
          label: t(`period_${id}`),
        }))}
      />

      {showMetrics && (
        <CardSelector
          label={t("metric_label")}
          value={metric}
          onChange={onMetricChange}
          options={metrics.map((id) => ({
            id,
            label: t(`metric_${id}`),
            icon: <MetricIcon metric={id} size={14} />,
          }))}
        />
      )}
    </div>
  );
}
