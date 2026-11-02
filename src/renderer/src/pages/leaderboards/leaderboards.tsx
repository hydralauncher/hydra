import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrophyIcon } from "@primer/octicons-react";
import { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useSearchParams } from "react-router-dom";

import { useLeaderboardFilters } from "../game-details/leaderboard/use-leaderboard-filters";
import {
  buildMetricsRequest,
  GLOBAL_LEADERBOARD_PERIODS,
  GLOBAL_LEADERBOARD_SCOPES,
  LEADERBOARD_PAGE_TABS,
  normalizeMetricDefinitions,
  normalizeMyGames,
  resolveWeekRange,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type LeaderboardPageTab,
} from "./global-leaderboard";
import { useFeature, useGlobalLeaderboardsFeature } from "@renderer/hooks";
import {
  attributeNextLeaderboardRequest,
  leaderboardsCache,
} from "@renderer/services/leaderboards-cache";
import { buildLeaderboardBoardPath, isLeaderboardSourceParam } from "@shared";
import { useApiResource, useLeaderboardViewer } from "./leaderboards-api";
import { BadgesSection } from "./badges-section";
import { HeaderSelector } from "./header-selector";
import { ByGameTab, gameKey, type LinkedGame } from "./by-game-tab";
import { LeaderboardsSidebar } from "./leaderboards-sidebar";
import { RankingTab } from "./ranking-tab";
import { StatsTab } from "./stats-tab";
import { useGlobalLeaderboards } from "./use-global-leaderboards";
import { WeekSubtitle } from "./week-subtitle";
import "../game-details/leaderboard/leaderboard.scss";
import "./leaderboards.scss";

function LeaderboardsPage() {
  const { t } = useTranslation("leaderboards");
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: locationKey } = useLocation();
  const tabParam = searchParams.get("tab");
  const shopParam = searchParams.get("shop");
  const objectIdParam = searchParams.get("objectId");
  const periodParam = searchParams.get("period");
  const scopeParam = searchParams.get("scope");
  const metricParam = searchParams.get("metric");
  const linkedTab = (
    LEADERBOARD_PAGE_TABS as readonly (string | null)[]
  ).includes(tabParam)
    ? (tabParam as LeaderboardPageTab)
    : null;
  const linkedGame = useMemo<LinkedGame | null>(
    () =>
      shopParam && objectIdParam
        ? { shop: shopParam, objectId: objectIdParam }
        : null,
    [objectIdParam, shopParam]
  );
  const [requestedTab, setRequestedTab] = useState<LeaderboardPageTab>(
    linkedTab ?? "ranking"
  );
  const [requestedMetric, setRequestedMetric] = useState<string | null>(
    linkedGame ? null : metricParam
  );

  const {
    period,
    scope: requestedScope,
    setPeriod,
    setScope: setRequestedScope,
    showPeriod,
    showScope,
  } = useLeaderboardFilters({
    period: (GLOBAL_LEADERBOARD_PERIODS as readonly (string | null)[]).includes(
      periodParam
    )
      ? (periodParam as GlobalLeaderboardPeriod)
      : null,
    scope: (GLOBAL_LEADERBOARD_SCOPES as readonly (string | null)[]).includes(
      scopeParam
    )
      ? (scopeParam as GlobalLeaderboardScope)
      : null,
  });
  const [selectedGameKey, setSelectedGameKey] = useState<string | null>(
    linkedGame ? gameKey(linkedGame) : null
  );
  const [generation, setGeneration] = useState(0);

  const sourceParam = searchParams.get("source");
  const attributedSourceRef = useRef<string | null>(null);
  if (!sourceParam) attributedSourceRef.current = null;
  if (
    isLeaderboardSourceParam(sourceParam) &&
    metricParam &&
    attributedSourceRef.current !== searchParams.toString()
  ) {
    attributedSourceRef.current = searchParams.toString();
    attributeNextLeaderboardRequest({
      path: buildLeaderboardBoardPath(metricParam, linkedGame),
      scope: (GLOBAL_LEADERBOARD_SCOPES as readonly (string | null)[]).includes(
        scopeParam
      )
        ? (scopeParam as string)
        : "global",
      period: (
        GLOBAL_LEADERBOARD_PERIODS as readonly (string | null)[]
      ).includes(periodParam)
        ? (periodParam as string)
        : "week",
      source: sourceParam,
    });
  }

  useEffect(() => {
    if (metricParam && !linkedGame) setRequestedMetric(metricParam);
  }, [metricParam, linkedGame, locationKey]);

  useEffect(() => {
    if (
      (GLOBAL_LEADERBOARD_SCOPES as readonly (string | null)[]).includes(
        scopeParam
      )
    )
      showScope(scopeParam as GlobalLeaderboardScope);
  }, [scopeParam, locationKey, showScope]);

  useEffect(() => {
    if (
      (GLOBAL_LEADERBOARD_PERIODS as readonly (string | null)[]).includes(
        periodParam
      )
    )
      showPeriod(periodParam as GlobalLeaderboardPeriod);
  }, [periodParam, locationKey, showPeriod]);

  useEffect(() => {
    if (!sourceParam) return;
    setSearchParams(
      (params) => {
        params.delete("source");
        return params;
      },
      { replace: true }
    );
  }, [sourceParam, setSearchParams]);

  const { viewerUser, isLoggedIn } = useLeaderboardViewer();
  const { isFeatureEnabled, Feature } = useFeature();
  const showBadges = isFeatureEnabled(Feature.LeaderboardBadges);
  const scope = isLoggedIn ? requestedScope : "global";

  useEffect(() => {
    if (linkedTab) setRequestedTab(linkedTab);
    if (linkedGame) setSelectedGameKey(gameKey(linkedGame));
  }, [linkedTab, linkedGame]);

  const games = useApiResource(
    isLoggedIn ? "/leaderboards/me/games" : null,
    { params: { window: period, scope }, needsAuth: true },
    normalizeMyGames
  );
  const lastGamesRef = useRef(games.data);
  if (games.data) lastGamesRef.current = games.data;
  const shownGames =
    games.data ?? (games.isLoading ? lastGamesRef.current : null);
  const myGames = useMemo(() => shownGames ?? [], [shownGames]);

  // Without a game to show, a filter or a link falls back to the categories.
  const hasNoGameToShow =
    !linkedGame && !games.isLoading && myGames.length === 0;
  let tab: LeaderboardPageTab = isLoggedIn ? requestedTab : "ranking";
  if (tab === "games" && hasNoGameToShow) tab = "ranking";

  // A linked game outside the viewer's list is not in the sidebar, so nothing
  // is selected there. Otherwise the first game stands in for an unlisted one.
  const isSelectedGameListed = myGames.some(
    (game) => gameKey(game) === selectedGameKey
  );
  let activeGameKey = selectedGameKey;
  if (!isSelectedGameListed) {
    activeGameKey = linkedGame || !myGames[0] ? null : gameKey(myGames[0]);
  }

  const metricsRequest = buildMetricsRequest("global");
  const metricDefinitions = useApiResource(
    metricsRequest.path,
    metricsRequest.options,
    normalizeMetricDefinitions
  );
  const metricIds = useMemo(
    () => (metricDefinitions.data ?? []).map((definition) => definition.id),
    [metricDefinitions.data]
  );

  const { results, retry } = useGlobalLeaderboards({
    metrics: metricIds,
    period,
    scope,
    isLoggedIn,
    accountId: viewerUser?.id ?? null,
  });

  const availableMetrics = useMemo(
    () => metricDefinitions.data ?? [],
    [metricDefinitions.data]
  );
  const metric =
    availableMetrics.find((definition) => definition.id === requestedMetric) ??
    availableMetrics[0] ??
    null;

  const loadedBoard =
    Object.values(results).find((result) => result?.leaderboard)?.leaderboard ??
    null;
  const lastBoardRef = useRef(loadedBoard);
  if (loadedBoard) lastBoardRef.current = loadedBoard;
  const referenceBoard = loadedBoard ?? lastBoardRef.current;
  const [weekClock, setWeekClock] = useState(Date.now);
  const weekRange = useMemo(
    () => resolveWeekRange(referenceBoard, weekClock),
    [referenceBoard, weekClock]
  );

  const { retry: retryMetrics } = metricDefinitions;
  const retryAll = useCallback(() => {
    retryMetrics();
    retry();
  }, [retryMetrics, retry]);

  const weekKey = weekRange.start.toISOString().slice(0, 10);
  const lastWeekKeyRef = useRef(weekKey);

  useEffect(() => {
    if (lastWeekKeyRef.current === weekKey) return;
    lastWeekKeyRef.current = weekKey;
    setGeneration((value) => value + 1);
  }, [weekKey]);

  const refetchedSourceRef = useRef(attributedSourceRef.current);
  useEffect(() => {
    const attributed = attributedSourceRef.current;
    if (!attributed) {
      refetchedSourceRef.current = null;
      return;
    }
    if (attributed === refetchedSourceRef.current) return;
    refetchedSourceRef.current = attributed;
    setGeneration((value) => value + 1);
    retry();
  }, [searchParams, retry]);

  const handleWeekEnd = useCallback(() => {
    leaderboardsCache.clear();
    setWeekClock(Date.now());
    retry();
  }, [retry]);

  // Leaving a game that came from a game page's link drops the link, so it
  // does not come back when the viewer returns to their own games.
  const dropGameLink = () => {
    if (!linkedGame) return;

    setSearchParams(
      (params) => {
        ["tab", "shop", "objectId", "metric", "period", "scope"].forEach(
          (name) => params.delete(name)
        );
        return params;
      },
      { replace: true }
    );
  };

  const handleViewChange = (value: LeaderboardPageTab) => {
    setRequestedTab(value);
    dropGameLink();
    document.getElementById("scrollableDiv")?.scrollTo({ top: 0 });
  };

  const openMetric = (value: string) => {
    setRequestedMetric(value);
    handleViewChange("ranking");
  };

  const openGame = (key: string) => {
    setSelectedGameKey(key);
    handleViewChange("games");
  };

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="leaderboards">
        <header className="leaderboards__header">
          <div className="leaderboards__heading">
            <WeekSubtitle
              weekRange={weekRange}
              isAllTime={period === "all"}
              onWeekEnd={handleWeekEnd}
            />
          </div>

          <div className="leaderboards__toggles">
            {isLoggedIn && (
              <HeaderSelector
                label={t("scope_label")}
                value={scope}
                onChange={setRequestedScope}
                options={GLOBAL_LEADERBOARD_SCOPES.map((id) => ({
                  id,
                  label: t(`scope_${id}`),
                }))}
              />
            )}

            <HeaderSelector
              label={t("period_label")}
              value={period}
              onChange={setPeriod}
              options={GLOBAL_LEADERBOARD_PERIODS.map((id) => ({
                id,
                label: t(`period_${id}`),
              }))}
            />
          </div>
        </header>

        <div className="leaderboards__body">
          <LeaderboardsSidebar
            results={results}
            metrics={availableMetrics}
            isMetricsLoading={metricDefinitions.isLoading}
            games={myGames}
            isGamesLoading={games.isLoading}
            hasGamesError={games.hasError}
            isLoggedIn={isLoggedIn}
            isStatsSelected={tab === "stats"}
            isGameBoardSelected={tab === "games"}
            selectedMetricId={tab === "ranking" ? (metric?.id ?? null) : null}
            selectedGameKey={tab === "games" ? activeGameKey : null}
            onSelectStats={() => handleViewChange("stats")}
            onSelectMetric={openMetric}
            onSelectGame={openGame}
            onRetryGames={games.retry}
          />

          <div key={generation} className="leaderboards__content">
            {tab === "ranking" && (
              <RankingTab
                results={results}
                metric={metric}
                isMetricsLoading={metricDefinitions.isLoading}
                hasMetricsError={metricDefinitions.hasError}
                period={period}
                scope={scope}
                viewerUser={viewerUser}
                onRetry={retryAll}
                onPeriodChange={setPeriod}
              />
            )}

            {tab === "games" && (
              <ByGameTab
                key={
                  linkedGame
                    ? `${linkedGame.shop}:${linkedGame.objectId}`
                    : "list"
                }
                period={period}
                scope={scope}
                viewerUser={viewerUser}
                initialGame={linkedGame}
                initialMetric={linkedGame ? metricParam : null}
                games={myGames}
                selectedKey={selectedGameKey}
                onScopeChange={setRequestedScope}
                onPeriodChange={setPeriod}
              />
            )}

            {tab === "stats" && (
              <StatsTab
                results={results}
                metrics={availableMetrics}
                period={period}
                viewerUser={viewerUser}
                onOpenMetric={openMetric}
                onRetry={retryAll}
              />
            )}

            {isLoggedIn ? (
              tab === "stats" && showBadges && <BadgesSection />
            ) : (
              <p className="leaderboards__sign-in">
                <TrophyIcon size={14} />
                {t("sign_in_hint")}
              </p>
            )}
          </div>
        </div>
      </section>
    </SkeletonTheme>
  );
}

export default function Leaderboards() {
  const { isEnabled, isLoaded } = useGlobalLeaderboardsFeature();

  if (!isEnabled) return isLoaded ? <Navigate to="/" replace /> : null;

  return <LeaderboardsPage />;
}
