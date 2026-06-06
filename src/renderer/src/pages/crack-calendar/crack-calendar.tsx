import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import cn from "classnames";
import { ChevronLeftIcon, ChevronRightIcon } from "@primer/octicons-react";

import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import { fetchAvailableMonths, fetchCalendarMonth } from "@renderer/features";
import { Button } from "@renderer/components";
import { getLastUpdatedLabel } from "@renderer/utils/get-last-updated-label";
import { formatCountdown } from "@renderer/utils/format-countdown";

import styles from "./crack-calendar.module.scss";

export default function CrackCalendar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const formatMonth = (monthStr: string) => {
    if (!monthStr) return "";
    const [year, month] = monthStr.split("-");
    if (!year || !month) return monthStr;
    const date = new Date(parseInt(year), parseInt(month) - 1);
    if (isNaN(date.getTime())) return monthStr;
    const monthName = date.toLocaleString(i18n.language, { month: "short" });
    const yearShort = year.slice(-2);
    return `${monthName} ${yearShort}`;
  };

  const {
    availableMonths,
    monthCache,
    selectedMonth,
    isLoading,
    searchResults,
    isSearching,
    searchQuery,
  } = useAppSelector((state) => state.crackCalendar);

  useEffect(() => {
    dispatch(fetchAvailableMonths()).then((action) => {
      if (
        fetchAvailableMonths.fulfilled.match(action) &&
        action.payload.length > 0
      ) {
        const currentMonthStr = new Date().toISOString().slice(0, 7);
        const monthToSelect = action.payload.includes(currentMonthStr)
          ? currentMonthStr
          : action.payload[0];

        if (!selectedMonth) {
          dispatch(fetchCalendarMonth({ month: monthToSelect }));
        }
      }
    });
  }, [dispatch]);

  useEffect(() => {
    const unsubscribe = window.electron.onCrackCalendarUpdated(() => {
      if (selectedMonth) {
        dispatch(
          fetchCalendarMonth({ month: selectedMonth, bypassCache: true })
        );
      }
    });

    return () => {
      unsubscribe();
    };
  }, [dispatch, selectedMonth]);

  const handleMonthClick = (month: string) => {
    dispatch(fetchCalendarMonth({ month }));
  };

  const handlePrevMonth = () => {
    const currentIndex = availableMonths.indexOf(selectedMonth!);
    if (currentIndex > 0) {
      handleMonthClick(availableMonths[currentIndex - 1]);
    }
  };

  const handleNextMonth = () => {
    const currentIndex = availableMonths.indexOf(selectedMonth!);
    if (currentIndex < availableMonths.length - 1) {
      handleMonthClick(availableMonths[currentIndex + 1]);
    }
  };

  const currentMonthData = selectedMonth ? monthCache[selectedMonth] : null;

  const dayGroups = useMemo(() => {
    if (!currentMonthData) return [];

    const gamesByDay: Record<string, any[]> = {};
    currentMonthData.games.forEach((game) => {
      const day = game.day || "Unknown";
      if (!gamesByDay[day]) gamesByDay[day] = [];
      gamesByDay[day].push(game);
    });

    if (
      Array.isArray(currentMonthData.days) &&
      currentMonthData.days.length > 0
    ) {
      const dayNumbersFromApi = new Set(
        currentMonthData.days.map((d) => d.dayNumber)
      );
      const gameDays = Object.keys(gamesByDay);

      const allDayNumbers = Array.from(
        new Set([...dayNumbersFromApi, ...gameDays])
      ).sort((a, b) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (isNaN(numA)) return 1;
        if (isNaN(numB)) return -1;
        return numA - numB;
      });

      return allDayNumbers
        .map((dayNum) => {
          const dayInfo = currentMonthData.days.find(
            (d) => d.dayNumber === dayNum
          );
          const games = gamesByDay[dayNum] || [];

          return {
            dayNumber: dayNum,
            dayName: dayInfo?.dayName || "",
            releases: dayInfo?.releases || String(games.length),
            games,
          };
        })
        .filter((group) => group.games.length > 0);
    }

    return Object.entries(gamesByDay)
      .sort(([a], [b]) => {
        const numA = parseInt(a);
        const numB = parseInt(b);
        if (isNaN(numA)) return 1;
        if (isNaN(numB)) return -1;
        return numA - numB;
      })
      .map(([day, games]) => ({
        dayNumber: day,
        dayName: "",
        releases: String(games.length),
        games,
      }));
  }, [currentMonthData]);

  const renderGameCard = (game: any) => {
    const handleCardClick = () => navigate(`/crack-calendar/${game.slug}`);

    return (
      <button
        type="button"
        className={styles.gameCard}
        onClick={handleCardClick}
      >
        <div className={styles.coverWrapper}>
          {game.image ? (
            <img
              src={game.image}
              alt={game.title}
              className={styles.gameImage}
            />
          ) : (
            <div className={styles.imagePlaceholder} />
          )}
          <div className={styles.badges}>
            <div
              className={cn(styles.crackBadge, {
                [styles.cracked]: game.crackStatus === "CRACKED",
                [styles.notCracked]: game.crackStatus === "NOT CRACKED",
                [styles.other]:
                  game.crackStatus !== "CRACKED" &&
                  game.crackStatus !== "NOT CRACKED",
              })}
            >
              {game.crackStatus}
            </div>
            <div
              className={cn(styles.releasePill, {
                [styles.released]: game.countdown === "Released",
                [styles.upcoming]: game.countdown !== "Released",
              })}
            >
              {formatCountdown(game.countdown)}
            </div>
          </div>
        </div>
        <div className={styles.gameDetails}>
          <span className={styles.gameTitle}>{game.title}</span>
        </div>
      </button>
    );
  };

  return (
    <SkeletonTheme baseColor="#202020" highlightColor="#444">
      <div className={styles.container}>
        {!searchQuery &&
          Array.isArray(availableMonths) &&
          availableMonths.length > 0 && (
            <div className={styles.monthSelector}>
              <Button
                className={styles.navButton}
                onClick={handlePrevMonth}
                disabled={selectedMonth === availableMonths[0] || isLoading}
                theme="outline"
              >
                <ChevronLeftIcon />
              </Button>
              <div className={styles.monthTabs}>
                {availableMonths.map((month) => (
                  <Button
                    key={month}
                    theme={selectedMonth === month ? "primary" : "outline"}
                    onClick={() => handleMonthClick(month)}
                    className={styles.monthTab}
                  >
                    {formatMonth(month)}
                  </Button>
                ))}
              </div>
              <Button
                className={styles.navButton}
                onClick={handleNextMonth}
                disabled={
                  selectedMonth ===
                    availableMonths[availableMonths.length - 1] || isLoading
                }
                theme="outline"
              >
                <ChevronRightIcon />
              </Button>

              {currentMonthData?.updated_at && (
                <span className={styles.lastUpdated}>
                  {getLastUpdatedLabel(currentMonthData.updated_at)}
                </span>
              )}
            </div>
          )}

        <div className={styles.content}>
          {searchQuery ? (
            <div className={styles.searchResults}>
              {isSearching ? (
                <div className={styles.loadingGrid}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} height={105} />
                  ))}
                </div>
              ) : Array.isArray(searchResults) && searchResults.length > 0 ? (
                <div className={styles.gameGrid}>
                  {searchResults.map(renderGameCard)}
                </div>
              ) : (
                <div className={styles.emptyState}>{t("No games found")}</div>
              )}
            </div>
          ) : (
            <div className={styles.calendarMode}>
              {isLoading ? (
                <div className={styles.loadingGrid}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Skeleton key={i} height={105} />
                  ))}
                </div>
              ) : dayGroups.length > 0 ? (
                <div className={styles.dayGroups}>
                  {dayGroups.map((group) => (
                    <div
                      key={group.dayNumber + group.dayName}
                      className={styles.dayGroup}
                    >
                      <h2 className={styles.dayHeader}>
                        {group.dayName}
                        {group.dayName ? ", " : ""}
                        {group.dayNumber} - {group.releases} Releases
                      </h2>
                      <div className={styles.gameGrid}>
                        {group.games.map(renderGameCard)}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyState}>
                  {t("Select a month to see releases")}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </SkeletonTheme>
  );
}
