import { useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "@renderer/hooks";
import {
  fetchAvailableMonths,
  fetchCalendarMonth,
  searchCalendar,
} from "@renderer/features";
import {
  Button,
  HorizontalFocusGroup,
  Typography,
  VerticalFocusGroup,
  FocusItem,
  GridFocusGroup,
  ScrollArea,
} from "../../components";
import { VerticalGameCard } from "../../components/common/vertical-game-card";
import {
  RELEASE_CALENDAR_PAGE_REGION_ID,
  RELEASE_CALENDAR_MONTH_TABS_REGION_ID,
  RELEASE_CALENDAR_GRID_REGION_ID,
  RELEASE_CALENDAR_EMPTY_STATE_ID,
  getReleaseCalendarMonthTabFocusId,
  getReleaseCalendarGameCardFocusId,
} from "./navigation";
import { useHeaderTitle, useNavigationScreenActions } from "../../hooks";
import { IS_DESKTOP } from "../../constants";
import { getLastUpdatedLabel } from "@renderer/utils/get-last-updated-label";
import { formatCountdown } from "@renderer/utils/format-countdown";
import { useReleaseCalendarGridNavigation } from "./use-release-calendar-grid-navigation";

import "./page.scss";

export default function ReleaseCalendar() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const dispatch = useAppDispatch();

  useHeaderTitle(t("release_calendar", { defaultValue: "Release Calendar" }));

  const searchQuery = searchParams.get("title") || "";

  const {
    availableMonths,
    monthCache,
    selectedMonth,
    isLoading,
    searchResults,
    isSearching,
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

  useEffect(() => {
    if (searchQuery.trim()) {
      dispatch(searchCalendar(searchQuery));
    }
  }, [dispatch, searchQuery]);

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

  useNavigationScreenActions({
    press: {
      l1: handlePrevMonth,
      r1: handleNextMonth,
    },
  });

  const currentMonthData = selectedMonth ? monthCache[selectedMonth] : null;

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

  const groupedGames = useMemo(() => {
    if (!currentMonthData) return [];
    const groups: Record<string, any[]> = {};
    currentMonthData.games.forEach((game) => {
      const day = game.day || "Unknown";
      if (!groups[day]) groups[day] = [];
      groups[day].push(game);
    });
    return Object.entries(groups).sort(([a], [b]) => parseInt(a) - parseInt(b));
  }, [currentMonthData]);

  const basePath = IS_DESKTOP ? "/big-picture" : "";

  const itemIds = useMemo(() => {
    if (searchQuery) {
      if (searchResults.length > 0) {
        return searchResults.map((game) =>
          getReleaseCalendarGameCardFocusId(game.slug)
        );
      }
      return [RELEASE_CALENDAR_EMPTY_STATE_ID];
    }
    if (currentMonthData) {
      if (currentMonthData.games.length > 0) {
        return currentMonthData.games.map((game) =>
          getReleaseCalendarGameCardFocusId(game.slug)
        );
      }
      return [RELEASE_CALENDAR_EMPTY_STATE_ID];
    }
    return [];
  }, [searchQuery, searchResults, currentMonthData]);

  const navigationOverridesByItemId = useReleaseCalendarGridNavigation(itemIds);

  return (
    <VerticalFocusGroup regionId={RELEASE_CALENDAR_PAGE_REGION_ID} asChild>
      <section className="release-calendar-page">
        <div className="release-calendar-container">
          <HorizontalFocusGroup
            regionId={RELEASE_CALENDAR_MONTH_TABS_REGION_ID}
            className="month-tabs-container"
          >
            <div className="month-nav-hint">
              <span className="bumper-hint">LB</span>
            </div>
            {availableMonths.map((month) => (
              <FocusItem
                key={month}
                id={getReleaseCalendarMonthTabFocusId(month)}
                actions={{
                  primary: () => handleMonthClick(month),
                }}
                asChild
              >
                <Button
                  variant={selectedMonth === month ? "primary" : "secondary"}
                  className="month-tab"
                  onClick={() => handleMonthClick(month)}
                >
                  {formatMonth(month)}
                </Button>
              </FocusItem>
            ))}
            <div className="month-nav-hint">
              <span className="bumper-hint">RB</span>
            </div>

            {currentMonthData?.updated_at && (
              <span className="last-updated">
                {getLastUpdatedLabel(currentMonthData.updated_at)}
              </span>
            )}
          </HorizontalFocusGroup>

          <ScrollArea className="calendar-scroll-area">
            <GridFocusGroup
              regionId={RELEASE_CALENDAR_GRID_REGION_ID}
              className="calendar-content game-grid"
            >
              {searchQuery ? (
                <>
                  <Typography variant="h3" className="day-title">
                    {t("search_results")}
                  </Typography>
                  {isSearching ? (
                    <Typography variant="body">Searching...</Typography>
                  ) : searchResults.length > 0 ? (
                    searchResults.map((game) => (
                      <FocusItem
                        key={game.slug}
                        id={getReleaseCalendarGameCardFocusId(game.slug)}
                        navigationOverrides={
                          navigationOverridesByItemId[
                            getReleaseCalendarGameCardFocusId(game.slug)
                          ]
                        }
                        actions={{
                          primary: () =>
                            navigate(`${basePath}/crack-calendar/${game.slug}`),
                        }}
                        asChild
                      >
                        <VerticalGameCard
                          gameTitle={game.title}
                          coverImageUrl={game.image}
                          subtitle={
                            game.crackStatus === "CRACKED"
                              ? "CRACKED"
                              : "NOT CRACKED"
                          }
                          progressLabel={
                            game.countdown === "Released"
                              ? "Released"
                              : formatCountdown(game.countdown)
                          }
                          progressValue={game.countdown === "Released" ? 1 : 0}
                          progressColor={
                            game.crackStatus === "CRACKED"
                              ? "var(--success)"
                              : "var(--error)"
                          }
                          hideProgressIcon={game.countdown !== "Released"}
                        />
                      </FocusItem>
                    ))
                  ) : (
                    <FocusItem
                      id={RELEASE_CALENDAR_EMPTY_STATE_ID}
                      navigationOverrides={
                        navigationOverridesByItemId[
                          RELEASE_CALENDAR_EMPTY_STATE_ID
                        ]
                      }
                      asChild
                    >
                      <Typography variant="body">
                        No results found for "{searchQuery}"
                      </Typography>
                    </FocusItem>
                  )}
                </>
              ) : isLoading && !currentMonthData ? (
                <Typography variant="body">Loading...</Typography>
              ) : groupedGames.length > 0 ? (
                groupedGames.flatMap(([day, games]) => [
                  <Typography
                    key={`title-${day}`}
                    variant="h3"
                    className="day-title"
                  >
                    {day} {formatMonth(selectedMonth!).split(" ")[0]}
                  </Typography>,
                  ...games.map((game) => (
                    <FocusItem
                      key={game.slug}
                      id={getReleaseCalendarGameCardFocusId(game.slug)}
                      navigationOverrides={
                        navigationOverridesByItemId[
                          getReleaseCalendarGameCardFocusId(game.slug)
                        ]
                      }
                      actions={{
                        primary: () =>
                          navigate(`${basePath}/crack-calendar/${game.slug}`),
                      }}
                      asChild
                    >
                      <VerticalGameCard
                        gameTitle={game.title}
                        coverImageUrl={game.image}
                        subtitle={
                          game.crackStatus === "CRACKED"
                            ? "CRACKED"
                            : "NOT CRACKED"
                        }
                        progressLabel={
                          game.countdown === "Released"
                            ? "Released"
                            : formatCountdown(game.countdown)
                        }
                        progressValue={game.countdown === "Released" ? 1 : 0}
                        progressColor={
                          game.crackStatus === "CRACKED"
                            ? "var(--success)"
                            : "var(--error)"
                        }
                        hideProgressIcon={game.countdown !== "Released"}
                      />
                    </FocusItem>
                  )),
                ])
              ) : (
                <FocusItem
                  id={RELEASE_CALENDAR_EMPTY_STATE_ID}
                  navigationOverrides={
                    navigationOverridesByItemId[RELEASE_CALENDAR_EMPTY_STATE_ID]
                  }
                  asChild
                >
                  <Typography variant="body">
                    No games found for this month.
                  </Typography>
                </FocusItem>
              )}
            </GridFocusGroup>
          </ScrollArea>
      </div>
    </section>
  </VerticalFocusGroup>
  );
}
