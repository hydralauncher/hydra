import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import cn from "classnames";
import {
  CalendarIcon,
  ChevronDownIcon,
  GlobeIcon,
  PeopleIcon,
} from "@primer/octicons-react";
import { useTranslation } from "react-i18next";

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

interface FilterOption<T extends string> {
  id: T;
  label: string;
}

interface FilterProps<T extends string> {
  label: string;
  icon: React.ReactNode;
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
}

function Filter<T extends string>({
  label,
  icon,
  options,
  value,
  onChange,
}: Readonly<FilterProps<T>>) {
  const selected = options.find((option) => option.id === value);

  return (
    <DropdownMenuPrimitive.Root modal={false}>
      <DropdownMenuPrimitive.Trigger asChild>
        <button
          type="button"
          className="leaderboard-controls__filter"
          aria-label={label}
        >
          {icon}
          <span className="leaderboard-controls__filter-label">
            {selected?.label}
          </span>
          <ChevronDownIcon
            size={12}
            className="leaderboard-controls__filter-chevron"
          />
        </button>
      </DropdownMenuPrimitive.Trigger>

      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="leaderboard-controls__filter-content"
        >
          <DropdownMenuPrimitive.RadioGroup
            value={value}
            onValueChange={(next) => onChange(next as T)}
          >
            {options.map((option) => (
              <DropdownMenuPrimitive.RadioItem
                key={option.id}
                value={option.id}
                className="leaderboard-controls__filter-item"
              >
                {option.label}
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
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
      <div className="leaderboard-controls__filters">
        {showScope && (
          <Filter
            label={t("scope_label")}
            icon={
              scope === "friends" ? (
                <PeopleIcon size={12} />
              ) : (
                <GlobeIcon size={12} />
              )
            }
            value={scope}
            onChange={onScopeChange}
            options={LEADERBOARD_SCOPES.map((id) => ({
              id,
              label: t(`scope_${id}`),
            }))}
          />
        )}

        <Filter
          label={t("period_label")}
          icon={<CalendarIcon size={12} />}
          value={period}
          onChange={onPeriodChange}
          options={LEADERBOARD_PERIODS.map((id) => ({
            id,
            label: t(`period_${id}`),
          }))}
        />
      </div>

      {showMetrics && (
        <SegmentedControl
          label={t("metric_label")}
          value={metric}
          onChange={onMetricChange}
          options={metrics.map((id) => ({
            id,
            label: t(`metric_${id}`),
          }))}
        />
      )}
    </div>
  );
}
