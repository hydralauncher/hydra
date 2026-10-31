import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Trans, useTranslation } from "react-i18next";
import InfiniteScroll from "react-infinite-scroll-component";
import {
  DeviceCameraIcon,
  FlameIcon,
  HistoryIcon,
  ImageIcon,
  StackIcon,
} from "@primer/octicons-react";

import { Button } from "@renderer/components";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  ScreenshotLoadMoreError,
  readStoredScreenshotSort,
  storeScreenshotPreference,
  useLoadUntilScrollable,
  useScreenshotCollection,
  type ScreenshotFeedPage,
} from "@renderer/components/screenshots";
import { useAppSelector, useFeature, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import {
  PROFILE_SCREENSHOT_GAME_STORAGE_KEY,
  PROFILE_SCREENSHOT_SORT_STORAGE_KEY,
} from "@renderer/session-state-keys";
import {
  buildUserScreenshotGamesPath,
  buildUserScreenshotsPath,
  formatScreenshotHotkey,
  resolveScreenshotPreferences,
} from "@shared";
import type {
  ScreenshotGameFilterItem,
  ScreenshotGamesResponse,
  ScreenshotSort,
  ScreenshotsHiddenReason,
  ScreenshotsResponse,
} from "@types";

import { FilterDropdown, type FilterDropdownOption } from "./filter-dropdown";
import { LockedProfile } from "./locked-profile";
import type { ProfileScreenshotsTotalUpdate } from "./screenshots-total";
import "./profile-content.scss";

const ALL_GAMES_FILTER = "all";
const INFINITE_SCROLL_THRESHOLD = 0.9;
const PROFILE_SCROLL_TARGET_ID = "scrollableDiv";
const TAB_PANEL_SLIDE_OFFSET_PX = 10;
const TAB_PANEL_TRANSITION_SECONDS = 0.2;

const getGameFilterValue = (game: ScreenshotGameFilterItem) =>
  game.shop === "custom" ? "custom" : `${game.shop}:${game.objectId}`;

const getGameFilterStorageKey = (userId: string) =>
  `${PROFILE_SCREENSHOT_GAME_STORAGE_KEY}:${userId}`;

const readStoredGameFilter = (userId: string) => {
  try {
    return (
      localStorage.getItem(getGameFilterStorageKey(userId)) ?? ALL_GAMES_FILTER
    );
  } catch {
    return ALL_GAMES_FILTER;
  }
};

interface ScreenshotsEmptyStateProps {
  isMe: boolean;
  isFiltered: boolean;
  hasFailed: boolean;
  hiddenReason: ScreenshotsHiddenReason;
  onRetry: () => void;
}

function ScreenshotsEmptyState({
  isMe,
  isFiltered,
  hasFailed,
  hiddenReason,
  onRetry,
}: Readonly<ScreenshotsEmptyStateProps>) {
  const { t } = useTranslation("screenshots");
  const hotkey = useAppSelector((state) =>
    formatScreenshotHotkey(
      resolveScreenshotPreferences(state.userPreferences.value).hotkey
    )
  );

  if (hasFailed) {
    return (
      <div className="profile-content__no-games profile-content__screenshots-empty">
        <h2>{t("screenshots_load_failed")}</h2>
        <Button theme="outline" onClick={onRetry}>
          {t("retry")}
        </Button>
      </div>
    );
  }

  if (!isMe && hiddenReason) {
    return (
      <div className="profile-content__screenshots-empty">
        <LockedProfile
          title={t(
            hiddenReason === "FRIENDS_ONLY"
              ? "screenshots_friends_only"
              : "screenshots_private"
          )}
        />
      </div>
    );
  }

  if (isFiltered) {
    return (
      <div className="profile-content__no-games profile-content__screenshots-empty">
        <h2>{t("no_screenshots_for_game")}</h2>
      </div>
    );
  }

  if (!isMe) {
    return (
      <div className="profile-content__no-games profile-content__screenshots-empty">
        <span className="profile-content__telescope-icon">
          <ImageIcon size={24} />
        </span>
        <h2>{t("no_user_screenshots")}</h2>
        <p>{t("no_user_screenshots_description")}</p>
      </div>
    );
  }

  return (
    <div className="profile-content__no-games profile-content__screenshots-empty">
      <span className="profile-content__telescope-icon">
        <DeviceCameraIcon size={24} />
      </span>
      <h2>{t("no_screenshots")}</h2>
      <p>
        <Trans
          i18nKey="no_screenshots_hotkey_tip"
          ns="screenshots"
          values={{ hotkey }}
          components={[
            <kbd
              key="hotkey"
              className="profile-content__screenshots-hotkey"
            />,
          ]}
        />
      </p>
    </div>
  );
}

interface ScreenshotsTabProps {
  userId: string;
  isMe: boolean;
  requestedScreenshotId: string | null;
  onRequestedScreenshotHandled: () => void;
  onTotalUpdate: (update: ProfileScreenshotsTotalUpdate) => void;
}

export function ScreenshotsTab({
  userId,
  isMe,
  requestedScreenshotId,
  onRequestedScreenshotHandled,
  onTotalUpdate,
}: Readonly<ScreenshotsTabProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled, Feature } = useFeature();
  const isCommentsEnabled = isFeatureEnabled(Feature.ScreenshotComments);
  const viewerId = userDetails?.id ?? null;
  const [sort, setSort] = useState<ScreenshotSort>(() =>
    readStoredScreenshotSort(PROFILE_SCREENSHOT_SORT_STORAGE_KEY)
  );
  const [gameFilter, setGameFilter] = useState(() =>
    readStoredGameFilter(userId)
  );
  const [games, setGames] = useState<ScreenshotGameFilterItem[]>([]);
  const [hasLoadedGames, setHasLoadedGames] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    setHasLoadedGames(false);

    window.electron.hydraApi
      .get<ScreenshotGamesResponse>(buildUserScreenshotGamesPath(userId), {
        needsAuth: Boolean(viewerId),
      })
      .then((response) => {
        if (isCurrent) setGames(response?.items ?? []);
      })
      .catch((error) => {
        logger.error("Failed to load screenshot games", error);
        if (isCurrent) setGames([]);
      })
      .finally(() => {
        if (isCurrent) setHasLoadedGames(true);
      });

    return () => {
      isCurrent = false;
    };
  }, [userId, viewerId]);

  const selectedGame = useMemo(
    () => games.find((game) => getGameFilterValue(game) === gameFilter) ?? null,
    [gameFilter, games]
  );
  const effectiveGameFilter =
    hasLoadedGames && !selectedGame ? ALL_GAMES_FILTER : gameFilter;
  const isFiltered = effectiveGameFilter !== ALL_GAMES_FILTER;

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<ScreenshotFeedPage | null> => {
      const response = await window.electron.hydraApi.get<ScreenshotsResponse>(
        buildUserScreenshotsPath({
          userId,
          cursor,
          sort,
          shop: selectedGame?.shop ?? null,
          objectId: selectedGame?.objectId ?? null,
        }),
        { needsAuth: Boolean(viewerId) }
      );

      return response ?? null;
    },
    [selectedGame, sort, userId, viewerId]
  );

  const collection = useScreenshotCollection({
    feedKey: hasLoadedGames
      ? [userId, viewerId, sort, effectiveGameFilter].join(":")
      : null,
    fetchPage,
    onServerTotal: (total) =>
      onTotalUpdate({ kind: "server", total, isFiltered, userId }),
    onItemRemoved: (removed) =>
      onTotalUpdate({ kind: "removed", userId: removed.owner.id }),
  });
  const { feed, actions, lightbox } = collection;

  useLoadUntilScrollable({
    scrollTargetId: PROFILE_SCROLL_TARGET_ID,
    canLoadMore:
      feed.hasLoaded &&
      feed.hasMore &&
      !feed.isLoading &&
      !feed.hasLoadMoreFailed,
    itemCount: feed.items.length,
    loadMore: feed.loadMore,
  });
  const { openById } = lightbox;

  useEffect(() => {
    if (!requestedScreenshotId) return;

    openById(userId, requestedScreenshotId);
    onRequestedScreenshotHandled();
  }, [onRequestedScreenshotHandled, openById, requestedScreenshotId, userId]);

  const sortOptions: FilterDropdownOption<ScreenshotSort>[] = [
    { value: "recent", label: t("sort_recent"), icon: HistoryIcon },
    { value: "top", label: t("sort_top"), icon: FlameIcon },
  ];

  const getGameTitle = (game: ScreenshotGameFilterItem) =>
    game.shop === "custom"
      ? t("custom_games")
      : (game.title ?? t("unknown_game"));

  const titleCounts = games.reduce<Record<string, number>>((counts, game) => {
    const title = getGameTitle(game);
    counts[title] = (counts[title] ?? 0) + 1;
    return counts;
  }, {});

  const getGameOptionLabel = (game: ScreenshotGameFilterItem) => {
    const title = getGameTitle(game);

    if (game.shop === "custom" || titleCounts[title] < 2) {
      return t("game_filter_option", { title, amount: game.count });
    }

    return t("game_filter_option_with_store", {
      title,
      store: t(`store_${game.shop}`),
      amount: game.count,
    });
  };

  const gameOptions: FilterDropdownOption<string>[] = [
    { value: ALL_GAMES_FILTER, label: t("all_games"), icon: StackIcon },
    ...games.map((game) => ({
      value: getGameFilterValue(game),
      label: getGameOptionLabel(game),
      icon: ImageIcon,
      imageUrl: game.iconUrl,
    })),
  ];

  const isInitialLoading =
    !feed.hasLoaded || (feed.isLoading && feed.items.length === 0);
  const showFilters = games.length > 0 && !feed.hiddenReason;

  return (
    <motion.div
      key="screenshots"
      className="profile-content__tab-panel"
      initial={{ opacity: 0, x: -TAB_PANEL_SLIDE_OFFSET_PX }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: TAB_PANEL_SLIDE_OFFSET_PX }}
      transition={{ duration: TAB_PANEL_TRANSITION_SECONDS }}
    >
      {showFilters ? (
        <div className="profile-content__library-filters">
          <FilterDropdown
            placeholder={t("game")}
            value={effectiveGameFilter}
            options={gameOptions}
            onChange={(value) => {
              setGameFilter(value);
              storeScreenshotPreference(getGameFilterStorageKey(userId), value);
            }}
          />

          <FilterDropdown
            placeholder={t("sort_by")}
            value={sort}
            options={sortOptions}
            onChange={(value) => {
              setSort(value);
              storeScreenshotPreference(
                PROFILE_SCREENSHOT_SORT_STORAGE_KEY,
                value
              );
            }}
          />
        </div>
      ) : null}

      {isInitialLoading ? (
        <output className="profile-content__screenshots-loading">
          {t("loading_screenshots")}
        </output>
      ) : null}

      {!isInitialLoading && feed.items.length === 0 ? (
        <ScreenshotsEmptyState
          isMe={isMe}
          isFiltered={isFiltered}
          hasFailed={feed.hasFailed}
          hiddenReason={feed.hiddenReason}
          onRetry={() => void feed.reload()}
        />
      ) : null}

      {feed.items.length > 0 ? (
        <InfiniteScroll
          dataLength={feed.items.length}
          next={() => void feed.loadMore()}
          hasMore={feed.hasMore && !feed.hasLoadMoreFailed}
          loader={
            feed.isLoading ? (
              <output className="profile-content__screenshots-loading">
                {t("loading_screenshots")}
              </output>
            ) : null
          }
          scrollThreshold={INFINITE_SCROLL_THRESHOLD}
          style={{ overflow: "visible" }}
          scrollableTarget={PROFILE_SCROLL_TARGET_ID}
        >
          <ul className="screenshot-grid screenshot-grid--large">
            {feed.items.map((screenshot) => (
              <ScreenshotCard
                key={screenshot.id}
                screenshot={screenshot}
                variant="profile"
                isOwner={isMe}
                isLiking={actions.likingIds.has(screenshot.id)}
                showCommentCount={isCommentsEnabled}
                onOpen={lightbox.open}
                onLike={(item) => void actions.toggleLike(item)}
                onImageError={lightbox.refreshScreenshot}
              />
            ))}
          </ul>
        </InfiniteScroll>
      ) : null}

      {feed.hasLoadMoreFailed ? (
        <ScreenshotLoadMoreError onRetry={() => void feed.loadMore()} />
      ) : null}

      <ScreenshotLightbox collection={collection} />
    </motion.div>
  );
}
