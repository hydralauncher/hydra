import { useContext, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClockIcon,
  GraphIcon,
  PeopleIcon,
  TrophyIcon,
} from "@primer/octicons-react";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";
import { useTranslation } from "react-i18next";

import { Button } from "@renderer/components";
import { gameDetailsContext } from "@renderer/context";
import { useFeature } from "@renderer/hooks";
import { AuthPage } from "@shared";
import { SidebarSection } from "../sidebar-section/sidebar-section";
import {
  buildMetricsRequest,
  normalizeMetricDefinitions,
} from "@renderer/pages/leaderboards/global-leaderboard";
import { useApiResource } from "@renderer/pages/leaderboards/leaderboards-api";
import {
  buildGameLeaderboardPath,
  buildLeaderboardRows,
  getLeaderboardNudge,
  getLeaderboardState,
  getServedMetrics,
  LEADERBOARD_CARD_SIZE,
  type LeaderboardMetric,
} from "./game-leaderboard";
import { LeaderboardControls } from "./leaderboard-controls";
import { LeaderboardRow } from "./leaderboard-row";
import { useGameLeaderboard } from "./use-game-leaderboard";
import { useLeaderboardFilters } from "./use-leaderboard-filters";
import { useLeaderboardValue } from "./use-leaderboard-value";
import "./leaderboard.scss";

const EMPTY_BOARD = { entries: [], viewer: null };
const LEADERBOARD_SKELETON_ROWS = LEADERBOARD_CARD_SIZE;
const LEADERBOARD_SKELETON_KEYS = Array.from(
  { length: LEADERBOARD_SKELETON_ROWS },
  (_, index) => `leaderboard-skeleton-${index}`
);

export function LeaderboardSection() {
  const { t } = useTranslation("leaderboard");
  const { catalogueGame } = useContext(gameDetailsContext);
  const navigate = useNavigate();
  const { isFeatureEnabled, Feature } = useFeature();
  const isExtended = isFeatureEnabled(Feature.GameLeaderboardsExtended);
  const formatValue = useLeaderboardValue();

  const {
    period,
    scope: selectedScope,
    setPeriod,
    setScope: setSelectedScope,
  } = useLeaderboardFilters();
  const [selectedMetric, setSelectedMetric] =
    useState<LeaderboardMetric>("playtime");

  const metricsRequest = buildMetricsRequest("game");
  const metricDefinitions = useApiResource(
    isExtended ? metricsRequest.path : null,
    metricsRequest.options,
    normalizeMetricDefinitions
  );
  const servedMetrics = useMemo(
    () =>
      getServedMetrics(
        metricDefinitions.data?.map((definition) => definition.id) ?? null
      ),
    [metricDefinitions.data]
  );
  const requestedMetric = servedMetrics.includes(selectedMetric)
    ? selectedMetric
    : servedMetrics[0];

  const {
    leaderboard,
    isLoading,
    hasError,
    isEligible,
    isLoggedIn,
    viewerUser,
    scope,
    metric,
    dataMetric,
    dataScope,
    dataPeriod,
    retry,
  } = useGameLeaderboard({
    shop: catalogueGame.shop,
    objectId: catalogueGame.objectId,
    period,
    scope: selectedScope,
    metric: requestedMetric,
    isExtended,
  });

  const state = getLeaderboardState({
    isEligible,
    hasError,
    leaderboard,
    period: dataPeriod,
    scope: dataScope,
    viewerId: viewerUser?.id ?? null,
  });

  const board = leaderboard ?? EMPTY_BOARD;
  const rows = useMemo(
    () => buildLeaderboardRows(board, viewerUser, LEADERBOARD_CARD_SIZE),
    [board, viewerUser]
  );
  const nudge = useMemo(
    () => getLeaderboardNudge(board, viewerUser, dataScope),
    [board, viewerUser, dataScope]
  );

  if (state === "hidden") return null;

  const renderNudge = () => {
    if (!nudge) return null;

    const text =
      nudge.type === "leading"
        ? t("nudge_leading")
        : t(nudge.type === "to_top" ? "nudge_to_top" : "nudge_behind", {
            amount: formatValue(dataMetric, nudge.gap),
            rank: nudge.type === "to_top" ? nudge.rank : nudge.targetRank,
          });

    return (
      <>
        <GraphIcon size={12} />
        <span className="leaderboard-row__subtitle-text">{text}</span>
      </>
    );
  };

  const renderEmpty = (
    icon: React.ReactNode,
    title: string,
    description: string | null,
    action: React.ReactNode
  ) => (
    <div className="leaderboard-section__empty">
      {icon}
      <p className="leaderboard-section__empty-title">{title}</p>
      {description && (
        <p className="leaderboard-section__empty-description">{description}</p>
      )}
      {action}
    </div>
  );

  const renderBody = () => {
    // Also while a filter change loads, so the old board does not stay on screen.
    const isShowingOldBoard =
      dataPeriod !== period || dataScope !== scope || dataMetric !== metric;

    if (state === "loading" || (state !== "error" && isShowingOldBoard)) {
      return (
        <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
          <div className="leaderboard-section__skeleton" aria-busy="true">
            {LEADERBOARD_SKELETON_KEYS.map((key) => (
              <Skeleton
                key={key}
                className="leaderboard-section__skeleton-row"
              />
            ))}
          </div>
        </SkeletonTheme>
      );
    }

    if (state === "error") {
      return renderEmpty(
        null,
        t("error_title"),
        null,
        <Button theme="outline" size="small" onClick={retry}>
          {t("retry")}
        </Button>
      );
    }

    if (state === "empty_week") {
      return renderEmpty(
        <ClockIcon size={20} />,
        t("empty_week_title"),
        t("empty_week_description"),
        <Button theme="outline" size="small" onClick={() => setPeriod("all")}>
          {t("see_all_time")}
        </Button>
      );
    }

    if (state === "empty_all") {
      return renderEmpty(
        <TrophyIcon size={20} />,
        t("empty_all_title"),
        t("empty_all_description"),
        null
      );
    }

    if (state === "empty_friends") {
      return (
        <>
          {renderEmpty(
            <PeopleIcon size={20} />,
            t("empty_friends_title"),
            t("empty_friends_description"),
            null
          )}
          <ol className="leaderboard-section__list">
            {rows.map((row) => (
              <LeaderboardRow
                key={row.entry.user.id}
                row={row}
                value={formatValue(dataMetric, row.entry.value)}
                showProgress={false}
                strip
              />
            ))}
          </ol>
          <div className="leaderboard-section__footer">
            <Button
              theme="outline"
              size="small"
              onClick={() => globalThis.window.electron.openFriendsWindow()}
            >
              {t("find_friends")}
            </Button>
          </div>
        </>
      );
    }

    if (state === "solo") {
      return (
        <>
          <ol className="leaderboard-section__list" aria-busy={isLoading}>
            {rows.map((row) => (
              <LeaderboardRow
                key={row.entry.user.id}
                row={row}
                value={formatValue(dataMetric, row.entry.value)}
                showProgress={false}
                strip
              />
            ))}
          </ol>
          {renderEmpty(
            <PeopleIcon size={20} />,
            t("solo_title"),
            t("solo_description"),
            <Button
              theme="outline"
              size="small"
              onClick={() => globalThis.window.electron.openFriendsWindow()}
            >
              {t("find_friends")}
            </Button>
          )}
        </>
      );
    }

    return (
      <>
        <ol className="leaderboard-section__list" aria-busy={isLoading}>
          {rows.map((row) => (
            <LeaderboardRow
              key={row.entry.user.id}
              row={row}
              value={formatValue(dataMetric, row.entry.value)}
              showProgress={false}
              strip
              subtitle={row.isViewer ? renderNudge() : null}
            />
          ))}
        </ol>

        {isLoggedIn && (
          <div className="leaderboard-section__footer">
            <button
              type="button"
              className="leaderboard-section__see-all"
              onClick={() =>
                navigate(
                  buildGameLeaderboardPath(
                    catalogueGame.shop,
                    catalogueGame.objectId,
                    { period: dataPeriod, scope: dataScope, metric: dataMetric }
                  )
                )
              }
            >
              <TrophyIcon size={12} />
              {t("see_full_ranking")}
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <SidebarSection
      title={
        isExtended ? `${t("title")} · ${t(`metric_${metric}`)}` : t("title")
      }
    >
      <div className="leaderboard-section">
        <LeaderboardControls
          period={period}
          scope={scope}
          metric={metric}
          showScope={isExtended && isLoggedIn}
          metrics={servedMetrics}
          showMetrics={isExtended && servedMetrics.length > 1}
          onPeriodChange={setPeriod}
          onScopeChange={setSelectedScope}
          onMetricChange={setSelectedMetric}
        />

        {renderBody()}

        {!isLoggedIn && state !== "loading" && (
          <div className="leaderboard-section__sign-in">
            <p className="leaderboard-section__sign-in-text">
              {t(isExtended ? "sign_in_hint" : "sign_in_hint_position")}
            </p>
            <button
              type="button"
              className="leaderboard-section__sign-in-button"
              onClick={() =>
                globalThis.window.electron.openAuthWindow(AuthPage.SignIn)
              }
            >
              {t("sign_in")}
            </button>
          </div>
        )}
      </div>
    </SidebarSection>
  );
}
