import cn from "classnames";
import { GlobeIcon, PeopleIcon } from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

import {
  LEADERBOARD_METRICS,
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

function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
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
          {option.label}
        </button>
      ))}
    </div>
  );
}

export interface LeaderboardControlsProps {
  period: LeaderboardPeriod;
  scope: LeaderboardScope;
  metric: LeaderboardMetric;
  showScope: boolean;
  showMetrics: boolean;
  onPeriodChange: (period: LeaderboardPeriod) => void;
  onScopeChange: (scope: LeaderboardScope) => void;
  onMetricChange: (metric: LeaderboardMetric) => void;
}

export function LeaderboardControls({
  period,
  scope,
  metric,
  showScope,
  showMetrics,
  onPeriodChange,
  onScopeChange,
  onMetricChange,
}: LeaderboardControlsProps) {
  const { t } = useTranslation("leaderboard");

  const scopeIcons: Record<LeaderboardScope, React.ReactNode> = {
    global: <GlobeIcon size={12} />,
    friends: <PeopleIcon size={12} />,
  };

  return (
    <div className="leaderboard-controls">
      <div className="leaderboard-controls__row">
        {showScope && (
          <SegmentedControl
            label={t("scope_label")}
            value={scope}
            onChange={onScopeChange}
            options={LEADERBOARD_SCOPES.map((id) => ({
              id,
              label: t(`scope_${id}`),
              icon: scopeIcons[id],
            }))}
          />
        )}

        <SegmentedControl
          label={t("period_label")}
          value={period}
          onChange={onPeriodChange}
          options={LEADERBOARD_PERIODS.map((id) => ({
            id,
            label: t(`period_${id}`),
          }))}
        />
      </div>

      {showMetrics && (
        <div
          className="leaderboard-controls__metrics"
          role="group"
          aria-label={t("metric_label")}
          style={
            {
              "--metric-count": LEADERBOARD_METRICS.length,
              "--metric-index": Math.max(
                0,
                LEADERBOARD_METRICS.indexOf(metric)
              ),
            } as React.CSSProperties
          }
        >
          <span
            className="leaderboard-controls__metric-indicator"
            aria-hidden="true"
          />
          {LEADERBOARD_METRICS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={id === metric}
              className={cn("leaderboard-controls__metric", {
                "leaderboard-controls__metric--selected": id === metric,
              })}
              onClick={() => onMetricChange(id)}
            >
              {t(`metric_${id}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
