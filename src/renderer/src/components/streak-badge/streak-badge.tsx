import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import cn from "classnames";
import { Tooltip } from "react-tooltip";

import { getDisplayStreak } from "@shared";
import flameIconAnimated from "@renderer/assets/icons/flame-animated.gif";
import flameIconStatic from "@renderer/assets/icons/flame-static.png";

import "./streak-badge.scss";

export interface StreakBadgeProps {
  currentStreak?: number;
  longestStreak?: number;
  lastStreakDate?: string | null;
  variant?: "full" | "compact";
  animated?: boolean;
  tooltipId?: string;
}

export function StreakBadge({
  currentStreak,
  longestStreak,
  lastStreakDate,
  variant = "full",
  animated = true,
  tooltipId,
}: Readonly<StreakBadgeProps>) {
  const { t } = useTranslation("game_details");

  const display = useMemo(
    () =>
      getDisplayStreak(
        {
          currentStreak: currentStreak ?? 0,
          longestStreak: longestStreak ?? 0,
          lastStreakDate: lastStreakDate ?? null,
        },
        new Date()
      ),
    [currentStreak, longestStreak, lastStreakDate]
  );

  if (display < 2) return null;

  const record = Math.max(longestStreak ?? 0, display);
  const tooltipContent = `${t("streak_days", { count: display })} • ${t(
    "streak_record",
    { count: record }
  )}`;

  return (
    <span
      className={cn("streak-badge", `streak-badge--${variant}`)}
      data-tooltip-id={tooltipId}
      data-tooltip-content={tooltipId ? tooltipContent : undefined}
      title={tooltipId ? undefined : tooltipContent}
    >
      <img
        src={animated ? flameIconAnimated : flameIconStatic}
        alt=""
        className="streak-badge__icon"
        draggable={false}
      />
      <span className="streak-badge__count">
        {variant === "compact"
          ? t("streak_compact", { count: display })
          : t("streak_days", { count: display })}
      </span>
      {tooltipId && <Tooltip id={tooltipId} style={{ zIndex: 9999 }} />}
    </span>
  );
}
