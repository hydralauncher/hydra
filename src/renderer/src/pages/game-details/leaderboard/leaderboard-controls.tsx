import cn from "classnames";
import {
  CalendarIcon,
  GlobeIcon,
  InfinityIcon,
  PeopleIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import { MetricIcon } from "@renderer/pages/leaderboards/metric-icon";

import {
  LEADERBOARD_PERIODS,
  LEADERBOARD_SCOPES,
  type LeaderboardMetric,
  type LeaderboardPeriod,
  type LeaderboardScope,
} from "./game-leaderboard";
import { useSelectorTooltip } from "./use-selector-tooltip";

interface CardSelectorOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ReactNode;
  // Replaces the name only when the card is too narrow for it.
  collapsedIcon?: React.ReactNode;
}

interface CardSelectorProps<T extends string> {
  label: string;
  options: CardSelectorOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

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
  const hasCollapsedIcons = options.some((option) => option.collapsedIcon);
  const { showTooltip, hideTooltip, tooltipElement } = useSelectorTooltip();

  // The name only needs a tooltip when it is not on screen.
  const showOptionTooltip = (
    element: HTMLElement,
    option: CardSelectorOption<T>
  ) => {
    const collapsibleLabel = element.querySelector(
      ".leaderboard-controls__selector-option-label"
    );

    if (option.icon || collapsibleLabel?.getClientRects().length === 0) {
      showTooltip(element, option.label);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn("leaderboard-controls__selector", {
        "leaderboard-controls__selector--icons": hasIcons,
        "leaderboard-controls__selector--collapsible": hasCollapsedIcons,
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
          aria-label={
            option.icon || option.collapsedIcon ? option.label : undefined
          }
          onMouseEnter={(event) =>
            showOptionTooltip(event.currentTarget, option)
          }
          onMouseLeave={hideTooltip}
          onFocus={(event) => {
            if (event.currentTarget.matches(":focus-visible")) {
              showOptionTooltip(event.currentTarget, option);
            }
          }}
          onBlur={hideTooltip}
          className={cn("leaderboard-controls__selector-option", {
            "leaderboard-controls__selector-option--selected":
              option.id === value,
          })}
          onClick={() => onChange(option.id)}
        >
          {option.icon ??
            (option.collapsedIcon ? (
              <>
                <span className="leaderboard-controls__selector-option-icon">
                  {option.collapsedIcon}
                </span>
                <span className="leaderboard-controls__selector-option-label">
                  {option.label}
                </span>
              </>
            ) : (
              option.label
            ))}
        </button>
      ))}
      {tooltipElement}
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

const PERIOD_ICONS: Record<LeaderboardPeriod, React.ReactNode> = {
  week: <CalendarIcon size={14} />,
  all: <InfinityIcon size={14} />,
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
          collapsedIcon: PERIOD_ICONS[id],
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
