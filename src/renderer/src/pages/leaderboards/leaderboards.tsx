import { useCallback, useEffect, useMemo, useState } from "react";
import cn from "classnames";
import { GlobeIcon, PeopleIcon, TrophyIcon } from "@primer/octicons-react";
import { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";
import { Navigate, useSearchParams } from "react-router-dom";

import { SegmentedControl } from "../game-details/leaderboard/leaderboard-controls";
import {
  buildMetricsRequest,
  getAvailableMetrics,
  GLOBAL_LEADERBOARD_PERIODS,
  GLOBAL_LEADERBOARD_SCOPES,
  LEADERBOARD_PAGE_TABS,
  normalizeMetricDefinitions,
  resolveWeekRange,
  type GlobalLeaderboardMetric,
  type GlobalLeaderboardPeriod,
  type GlobalLeaderboardScope,
  type LeaderboardPageTab,
} from "./global-leaderboard";
import {
  leaderboardsCache,
  useApiResource,
  useGlobalLeaderboardsFeature,
  useLeaderboardViewer,
} from "./leaderboards-api";
import { BadgesSection } from "./badges-section";
import { ByGameTab, type LinkedGame } from "./by-game-tab";
import { RankingTab } from "./ranking-tab";
import { StatsTab } from "./stats-tab";
import { useGlobalLeaderboards } from "./use-global-leaderboards";
import { WeekSubtitle } from "./week-subtitle";
import "../game-details/leaderboard/leaderboard.scss";
import "./leaderboards.scss";

function LeaderboardsPage() {
  const { t } = useTranslation("leaderboards");
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const shopParam = searchParams.get("shop");
  const objectIdParam = searchParams.get("objectId");
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
  const [requestedMetric, setRequestedMetric] =
    useState<GlobalLeaderboardMetric | null>(null);
  const [period, setPeriod] = useState<GlobalLeaderboardPeriod>("week");
  const [requestedScope, setRequestedScope] =
    useState<GlobalLeaderboardScope>("global");
  const [generation, setGeneration] = useState(0);

  const { viewerUser, isLoggedIn } = useLeaderboardViewer();
  const scope = isLoggedIn ? requestedScope : "global";
  const tab = isLoggedIn ? requestedTab : "ranking";

  useEffect(() => {
    if (linkedTab) setRequestedTab(linkedTab);
  }, [linkedTab, linkedGame]);
  const tabs = isLoggedIn
    ? LEADERBOARD_PAGE_TABS
    : LEADERBOARD_PAGE_TABS.slice(0, 1);

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
    () => getAvailableMetrics(metricDefinitions.data ?? [], results),
    [metricDefinitions.data, results]
  );
  const metric =
    availableMetrics.find((definition) => definition.id === requestedMetric) ??
    availableMetrics[0] ??
    null;

  const referenceBoard =
    Object.values(results).find((result) => result?.leaderboard)?.leaderboard ??
    null;
  const [weekClock, setWeekClock] = useState(Date.now);
  const weekRange = useMemo(
    () => resolveWeekRange(referenceBoard, weekClock),
    [referenceBoard, weekClock]
  );

  const retryAll = useCallback(() => {
    metricDefinitions.retry();
    retry();
  }, [metricDefinitions, retry]);

  const handleWeekEnd = useCallback(() => {
    leaderboardsCache.clear();
    setWeekClock(Date.now());
    retry();
    setGeneration((value) => value + 1);
  }, [retry]);

  const scopeIcons: Record<GlobalLeaderboardScope, React.ReactNode> = {
    global: <GlobeIcon size={14} />,
    friends: <PeopleIcon size={14} />,
  };

  const openMetric = (value: GlobalLeaderboardMetric) => {
    setRequestedMetric(value);
    setRequestedTab("ranking");
  };

  return (
    <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
      <section className="leaderboards">
        <header className="leaderboards__header">
          <div className="leaderboards__heading">
            <h1 className="leaderboards__title">{t("title")}</h1>
            <WeekSubtitle
              weekRange={weekRange}
              isAllTime={period === "all"}
              onWeekEnd={handleWeekEnd}
            />
          </div>

          <div className="leaderboards__toggles leaderboard-controls__row">
            {isLoggedIn && (
              <SegmentedControl
                label={t("scope_label")}
                value={scope}
                onChange={setRequestedScope}
                options={GLOBAL_LEADERBOARD_SCOPES.map((id) => ({
                  id,
                  label: t(`scope_${id}`),
                  icon: scopeIcons[id],
                }))}
              />
            )}

            <SegmentedControl
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

        <div
          className="leaderboards__tabs"
          role="tablist"
          aria-label={t("tabs_label")}
        >
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={id === tab}
              className={cn("leaderboards__tab", {
                "leaderboards__tab--selected": id === tab,
              })}
              onClick={() => setRequestedTab(id)}
            >
              {t(`tab_${id}`)}
            </button>
          ))}
        </div>

        <div key={generation} className="leaderboards__content">
          {tab === "ranking" && (
            <RankingTab
              results={results}
              metrics={availableMetrics}
              metric={metric}
              isMetricsLoading={metricDefinitions.isLoading}
              hasMetricsError={metricDefinitions.hasError}
              onMetricChange={setRequestedMetric}
              period={period}
              scope={scope}
              viewerUser={viewerUser}
              onRetry={retryAll}
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
            />
          )}

          {tab === "stats" && (
            <StatsTab
              results={results}
              metrics={availableMetrics}
              period={period}
              viewerUser={viewerUser}
              onOpenMetric={openMetric}
            />
          )}

          {isLoggedIn ? (
            <BadgesSection />
          ) : (
            <p className="leaderboards__sign-in">
              <TrophyIcon size={14} />
              {t("sign_in_hint")}
            </p>
          )}
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
