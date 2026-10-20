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
  readStoredScreenshotSort,
  storeScreenshotPreference,
  useScreenshotCollection,
  type ScreenshotFeedPage,
} from "@renderer/components/screenshots";
import { useAppSelector, useUserDetails } from "@renderer/hooks";
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
import "./profile-content.scss";

const ALL_GAMES_FILTER = "all";

const getGameFilterValue = (game: ScreenshotGameFilterItem) =>
  game.shop === "custom" ? "custom" : `${game.shop}:${game.objectId}`;

const readStoredGameFilter = () => {
  try {
    return (
      localStorage.getItem(PROFILE_SCREENSHOT_GAME_STORAGE_KEY) ??
      ALL_GAMES_FILTER
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
  onTotalChange: (total: number) => void;
}

export function ScreenshotsTab({
  userId,
  isMe,
  requestedScreenshotId,
  onRequestedScreenshotHandled,
  onTotalChange,
}: Readonly<ScreenshotsTabProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const viewerId = userDetails?.id ?? null;
  const [sort, setSort] = useState<ScreenshotSort>(() =>
    readStoredScreenshotSort(PROFILE_SCREENSHOT_SORT_STORAGE_KEY)
  );
  const [gameFilter, setGameFilter] = useState(readStoredGameFilter);
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
  });
  const { feed, actions, lightbox } = collection;
  const { openById } = lightbox;

  useEffect(() => {
    if (!isFiltered && feed.total !== null) onTotalChange(feed.total);
  }, [feed.total, isFiltered, onTotalChange]);

  useEffect(() => {
    if (!requestedScreenshotId) return;

    openById(userId, requestedScreenshotId);
    onRequestedScreenshotHandled();
  }, [onRequestedScreenshotHandled, openById, requestedScreenshotId, userId]);

  const sortOptions: FilterDropdownOption<ScreenshotSort>[] = [
    { value: "recent", label: t("sort_recent"), icon: HistoryIcon },
    { value: "top", label: t("sort_top"), icon: FlameIcon },
  ];

  const gameOptions: FilterDropdownOption<string>[] = [
    { value: ALL_GAMES_FILTER, label: t("all_games"), icon: StackIcon },
    ...games.map((game) => ({
      value: getGameFilterValue(game),
      label: t("game_filter_option", {
        title:
          game.shop === "custom"
            ? t("custom_games")
            : (game.title ?? t("unknown_game")),
        amount: game.count,
      }),
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
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 10 }}
      transition={{ duration: 0.2 }}
    >
      {showFilters ? (
        <div className="profile-content__library-filters">
          <FilterDropdown
            placeholder={t("game")}
            value={effectiveGameFilter}
            options={gameOptions}
            onChange={(value) => {
              setGameFilter(value);
              storeScreenshotPreference(
                PROFILE_SCREENSHOT_GAME_STORAGE_KEY,
                value
              );
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
        <p className="profile-content__souvenirs-loading" role="status">
          {t("loading_screenshots")}
        </p>
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
          hasMore={feed.hasMore}
          loader={
            <p className="profile-content__souvenirs-loading" role="status">
              {t("loading_screenshots")}
            </p>
          }
          scrollThreshold={0.9}
          style={{ overflow: "visible" }}
          scrollableTarget="scrollableDiv"
        >
          <ul className="screenshot-grid">
            {feed.items.map((screenshot) => (
              <ScreenshotCard
                key={screenshot.id}
                screenshot={screenshot}
                variant="profile"
                isOwner={isMe}
                isLiking={actions.likingIds.has(screenshot.id)}
                onOpen={lightbox.open}
                onLike={(item) => void actions.toggleLike(item)}
              />
            ))}
          </ul>
        </InfiniteScroll>
      ) : null}

      <ScreenshotLightbox collection={collection} />
    </motion.div>
  );
}
