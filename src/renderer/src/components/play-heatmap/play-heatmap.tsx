import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "react-tooltip";
import cn from "classnames";

import type { LibraryGame } from "@types";
import { toLocalDateKey } from "@shared";

import "./play-heatmap.scss";

const TOTAL_WEEKS = 53;
const DAYS_IN_WEEK = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface DayCell {
  dateKey: string;
  date: Date;
  games: LibraryGame[];
  intensity: number;
  inFuture: boolean;
}

export interface PlayHeatmapProps {
  library: LibraryGame[];
  tooltipId?: string;
}

const startOfWeek = (date: Date): Date => {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  result.setDate(result.getDate() - day);
  return result;
};

export function PlayHeatmap({
  library,
  tooltipId = "play-heatmap-tooltip",
}: Readonly<PlayHeatmapProps>) {
  const { t, i18n } = useTranslation("home");

  const datesByDay = useMemo(() => {
    const map = new Map<string, LibraryGame[]>();
    for (const game of library) {
      if (!game.playedDates?.length) continue;
      for (const dateKey of game.playedDates) {
        const list = map.get(dateKey);
        if (list) list.push(game);
        else map.set(dateKey, [game]);
      }
    }
    return map;
  }, [library]);

  const { weeks, monthLabels, totalActiveDays } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = toLocalDateKey(today);

    const lastWeekStart = startOfWeek(today);
    const firstWeekStart = new Date(
      lastWeekStart.getTime() - (TOTAL_WEEKS - 1) * 7 * MS_PER_DAY
    );

    const weeksAcc: DayCell[][] = [];
    const monthLabelsAcc: { weekIndex: number; label: string }[] = [];
    let lastMonth = -1;
    let activeCount = 0;

    const monthFmt = new Intl.DateTimeFormat(i18n.language, { month: "short" });

    for (let w = 0; w < TOTAL_WEEKS; w++) {
      const week: DayCell[] = [];
      for (let d = 0; d < DAYS_IN_WEEK; d++) {
        const date = new Date(
          firstWeekStart.getTime() + (w * 7 + d) * MS_PER_DAY
        );
        const dateKey = toLocalDateKey(date);
        const games = datesByDay.get(dateKey) ?? [];
        const intensity =
          games.length === 0
            ? 0
            : games.length === 1
              ? 1
              : games.length === 2
                ? 2
                : games.length === 3
                  ? 3
                  : 4;
        if (games.length > 0) activeCount++;

        week.push({
          dateKey,
          date,
          games,
          intensity,
          inFuture: dateKey > todayKey,
        });
      }

      const firstOfMonthInWeek = week.find((cell) => cell.date.getDate() === 1);
      if (firstOfMonthInWeek) {
        const month = firstOfMonthInWeek.date.getMonth();
        if (month !== lastMonth) {
          monthLabelsAcc.push({
            weekIndex: w,
            label: monthFmt.format(firstOfMonthInWeek.date),
          });
          lastMonth = month;
        }
      }

      weeksAcc.push(week);
    }

    return {
      weeks: weeksAcc,
      monthLabels: monthLabelsAcc,
      totalActiveDays: activeCount,
    };
  }, [datesByDay, i18n.language]);

  const dateFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    [i18n.language]
  );

  const buildTooltip = (cell: DayCell): string => {
    if (cell.inFuture) return "";
    if (cell.games.length === 0) {
      return `${dateFmt.format(cell.date)} — ${t("no_games_played")}`;
    }
    const titles = cell.games.map((g) => g.title).join(", ");
    return `${dateFmt.format(cell.date)} — ${t("games_played_count", {
      count: cell.games.length,
    })}: ${titles}`;
  };

  return (
    <div className="play-heatmap">
      <div className="play-heatmap__header">
        <span className="play-heatmap__summary">
          {t("active_days_in_year", { count: totalActiveDays })}
        </span>
        <div className="play-heatmap__legend">
          <span className="play-heatmap__legend-label">{t("less")}</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <span
              key={level}
              className={cn(
                "play-heatmap__cell",
                "play-heatmap__cell--legend",
                `play-heatmap__cell--level-${level}`
              )}
            />
          ))}
          <span className="play-heatmap__legend-label">{t("more")}</span>
        </div>
      </div>

      <div className="play-heatmap__scroll">
        <div className="play-heatmap__grid-wrapper">
          <div className="play-heatmap__months">
            {monthLabels.map(({ weekIndex, label }) => (
              <span
                key={`${weekIndex}-${label}`}
                className="play-heatmap__month-label"
                style={{ gridColumn: weekIndex + 1 }}
              >
                {label}
              </span>
            ))}
          </div>

          <div className="play-heatmap__grid">
            {weeks.map((week, w) => (
              <div key={w} className="play-heatmap__week">
                {week.map((cell) => (
                  <span
                    key={cell.dateKey}
                    className={cn(
                      "play-heatmap__cell",
                      `play-heatmap__cell--level-${cell.intensity}`,
                      { "play-heatmap__cell--future": cell.inFuture }
                    )}
                    data-tooltip-id={tooltipId}
                    data-tooltip-content={buildTooltip(cell)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <Tooltip id={tooltipId} style={{ zIndex: 9999, fontSize: 12 }} />
    </div>
  );
}
