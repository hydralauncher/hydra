import {
  ArrowClockwiseIcon,
  ImagesIcon,
  SortAscendingIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  UserProfile,
  ProfileScreenshot,
  ScreenshotGameFilterItem,
  ScreenshotGamesResponse,
  ScreenshotHotkeyBinding,
  ScreenshotSort,
  ScreenshotsHiddenReason,
} from "@types";
import {
  buildUserScreenshotGamesPath,
  DEFAULT_SCREENSHOT_HOTKEY,
  buildUserScreenshotsPath,
  formatScreenshotHotkey,
} from "@shared";
import { logger } from "@renderer/logger";
import { applyScreenshotsTotalUpdate } from "@renderer/pages/profile/profile-content/screenshots-total";

import {
  Button,
  DropdownSelect,
  HorizontalFocusGroup,
  Typography,
  type DropdownSelectOption,
} from "../../components";
import {
  ScreenshotRow,
  useScreenshotCardLike,
  useScreenshotFeed,
  useScreenshotLightbox,
} from "../../components/pages/screenshots";
import { BIG_PICTURE_SIDEBAR_PROFILE_ID } from "../../layout";
import type { FocusOverrideTarget } from "../../services";
import {
  PROFILE_SCREENSHOTS_CONTROLS_REGION_ID,
  PROFILE_SCREENSHOTS_FILTER_ID,
  PROFILE_SCREENSHOTS_LOAD_MORE_RETRY_ID,
  PROFILE_SCREENSHOTS_RETRY_ID,
  PROFILE_SCREENSHOTS_REGION_ID,
  PROFILE_SCREENSHOTS_SORT_ID,
  getProfileScreenshotItemId,
} from "./navigation";

const ALL_GAMES_FILTER = "all";
const SORT_STORAGE_KEY = "big-picture:screenshots-sort";
const FILTER_STORAGE_KEY_PREFIX = "big-picture:screenshots-filter:";

function readStoredValue(key: string) {
  try {
    return globalThis.window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function readStoredFilterKey(userId: string | null) {
  if (!userId) return ALL_GAMES_FILTER;
  return (
    readStoredValue(`${FILTER_STORAGE_KEY_PREFIX}${userId}`) ?? ALL_GAMES_FILTER
  );
}

function writeStoredValue(key: string, value: string) {
  try {
    globalThis.window.localStorage.setItem(key, value);
  } catch (error) {
    logger.warn("Failed to remember screenshot preference", error);
  }
}

function readStoredSort(): ScreenshotSort {
  return readStoredValue(SORT_STORAGE_KEY) === "top" ? "top" : "recent";
}

export function getScreenshotFilterKey(item: ScreenshotGameFilterItem) {
  return `${item.shop}:${item.objectId ?? ""}`;
}

interface UseProfileScreenshotsOptions {
  targetUserId: string | undefined;
  baseTotal: number | null;
  isEnabled: boolean;
  isSignedIn: boolean;
}

function useOverallScreenshotsTotal(
  baseTotal: number | null,
  feedTotal: number | null,
  isFiltered: boolean
) {
  const [overallTotal, setOverallTotal] = useState(baseTotal);

  useEffect(() => {
    setOverallTotal(baseTotal);
  }, [baseTotal]);

  useEffect(() => {
    if (feedTotal === null) return;

    setOverallTotal((current) => {
      if (current === null) return isFiltered ? null : feedTotal;

      return applyScreenshotsTotalUpdate(current, {
        kind: "server",
        total: feedTotal,
        isFiltered,
      });
    });
  }, [feedTotal, isFiltered]);

  const applyRemoval = useCallback(() => {
    setOverallTotal((current) =>
      current === null
        ? null
        : applyScreenshotsTotalUpdate(current, { kind: "removed" })
    );
  }, []);

  return { overallTotal, applyRemoval };
}

export function useProfileScreenshots({
  targetUserId,
  baseTotal,
  isEnabled,
  isSignedIn,
}: UseProfileScreenshotsOptions) {
  const [sortState, setSortState] = useState<ScreenshotSort>(readStoredSort);
  const activeUserId = isEnabled ? (targetUserId ?? null) : null;
  const [filterSelection, setFilterSelection] = useState<{
    userId: string | null;
    key: string;
  } | null>(null);
  const [gamesState, setGamesState] = useState<{
    userId: string;
    items: ScreenshotGameFilterItem[];
  } | null>(null);
  const filterKeyState =
    filterSelection?.userId === activeUserId
      ? filterSelection.key
      : readStoredFilterKey(activeUserId);
  const hasSettledGames = gamesState?.userId === activeUserId;
  const games = useMemo(
    () => (hasSettledGames && gamesState ? gamesState.items : []),
    [gamesState, hasSettledGames]
  );

  useEffect(() => {
    if (!activeUserId) return;

    let isCurrent = true;

    globalThis.window.electron.hydraApi
      .get<ScreenshotGamesResponse>(
        buildUserScreenshotGamesPath(activeUserId),
        {
          needsAuth: isSignedIn,
        }
      )
      .then((response) => {
        if (isCurrent) {
          setGamesState({ userId: activeUserId, items: response?.items ?? [] });
        }
      })
      .catch((error: unknown) => {
        logger.error("Failed to load screenshot games", error);
        if (isCurrent) setGamesState({ userId: activeUserId, items: [] });
      });

    return () => {
      isCurrent = false;
    };
  }, [activeUserId, isSignedIn]);

  const activeFilter = useMemo(
    () =>
      games.find((game) => getScreenshotFilterKey(game) === filterKeyState) ??
      null,
    [filterKeyState, games]
  );
  const effectiveFilterKey = activeFilter ? filterKeyState : ALL_GAMES_FILTER;
  const isWaitingForGames =
    filterKeyState !== ALL_GAMES_FILTER && !hasSettledGames;

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildUserScreenshotsPath({
        userId: activeUserId ?? "",
        cursor,
        sort: sortState,
        shop: activeFilter?.shop ?? null,
        objectId: activeFilter?.objectId ?? null,
      }),
    [activeFilter, activeUserId, sortState]
  );

  const feed = useScreenshotFeed({
    requestKey:
      activeUserId && !isWaitingForGames
        ? `${activeUserId}:${sortState}:${effectiveFilterKey}`
        : null,
    buildPath,
    needsAuth: isSignedIn,
  });

  const setSort = useCallback((nextSort: ScreenshotSort) => {
    setSortState(nextSort);
    writeStoredValue(SORT_STORAGE_KEY, nextSort);
  }, []);

  const setFilterKey = useCallback(
    (nextFilterKey: string) => {
      setFilterSelection({ userId: activeUserId, key: nextFilterKey });
      if (activeUserId)
        writeStoredValue(
          `${FILTER_STORAGE_KEY_PREFIX}${activeUserId}`,
          nextFilterKey
        );
    },
    [activeUserId]
  );

  const isFiltered = effectiveFilterKey !== ALL_GAMES_FILTER;
  const { overallTotal, applyRemoval } = useOverallScreenshotsTotal(
    baseTotal,
    feed.total,
    isFiltered
  );
  const {
    removeItem: removeFeedItem,
    removeDeletedItem: removeDeletedFeedItem,
  } = feed;
  const activeUserIdRef = useRef(activeUserId);
  activeUserIdRef.current = activeUserId;
  const isFilteredRef = useRef(isFiltered);
  isFilteredRef.current = isFiltered;
  const removeItem = useCallback(
    (screenshotId: string, ownerId: string) => {
      removeFeedItem(screenshotId);
      if (ownerId === activeUserIdRef.current) applyRemoval();
    },
    [applyRemoval, removeFeedItem]
  );
  const removeDeletedItem = useCallback(
    (screenshotId: string, ownerId: string) => {
      if (ownerId !== activeUserIdRef.current) {
        removeFeedItem(screenshotId);
        return;
      }

      if (isFilteredRef.current) removeFeedItem(screenshotId);
      else removeDeletedFeedItem(screenshotId);
      applyRemoval();
    },
    [applyRemoval, removeDeletedFeedItem, removeFeedItem]
  );

  return {
    ...feed,
    isLoading: feed.isLoading || isWaitingForGames,
    removeItem,
    removeDeletedItem,
    overallTotal,
    isEnabled: Boolean(activeUserId),
    sort: sortState,
    setSort,
    filterKey: effectiveFilterKey,
    isFiltered,
    setFilterKey,
    games,
  };
}

export type ProfileScreenshotsState = ReturnType<typeof useProfileScreenshots>;

interface UseProfileScreenshotsSectionOptions
  extends UseProfileScreenshotsOptions {
  searchParams: URLSearchParams;
  setSearchParams: (
    nextParams: URLSearchParams,
    options?: { replace?: boolean }
  ) => void;
}

export function useProfileScreenshotsSection({
  targetUserId,
  baseTotal,
  isEnabled,
  isSignedIn,
  searchParams,
  setSearchParams,
}: UseProfileScreenshotsSectionOptions) {
  const state = useProfileScreenshots({
    targetUserId,
    baseTotal,
    isEnabled,
    isSignedIn,
  });
  const { openById, open, lightboxProps } = useScreenshotLightbox({
    items: state.items,
    needsAuth: isSignedIn,
    updateItem: state.updateItem,
    removeItem: state.removeItem,
    removeDeletedItem: state.removeDeletedItem,
    getFetchedAt: state.getFetchedAt,
    imageRefresher: state.imageRefresher,
    hasMore: state.hasMore,
    loadMore: state.loadMore,
    hasLoadMoreError: state.error === "page",
    retryLoadMore: state.retry,
  });
  const requestedScreenshot = searchParams.get("screenshot");
  const canOpenRequested = Boolean(
    requestedScreenshot && targetUserId && state.isEnabled
  );

  useEffect(() => {
    if (!canOpenRequested || !requestedScreenshot || !targetUserId) return;

    void openById(targetUserId, requestedScreenshot);

    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("screenshot");
    nextParams.delete("tab");
    setSearchParams(nextParams, { replace: true });
  }, [
    canOpenRequested,
    openById,
    requestedScreenshot,
    searchParams,
    setSearchParams,
    targetUserId,
  ]);

  return { state, openScreenshot: open, lightboxProps };
}

export function getProfileScreenshotCount(
  profile: Pick<UserProfile, "id" | "screenshotCount"> | null,
  targetUserId: string | undefined
) {
  if (!targetUserId || profile?.id !== targetUserId) return null;

  return profile.screenshotCount ?? null;
}

export function getProfileScreenshotsFocusIds(state: ProfileScreenshotsState) {
  if (!state.isEnabled) {
    return { first: null, fromBelow: null };
  }

  const firstItem = state.items[0];
  const firstItemId = firstItem
    ? getProfileScreenshotItemId(firstItem.id)
    : null;
  const hasControls = shouldShowScreenshotControls(state);
  const controlsId = hasControls ? PROFILE_SCREENSHOTS_FILTER_ID : null;
  const retryId =
    state.error === "initial" ? PROFILE_SCREENSHOTS_RETRY_ID : null;

  return {
    first: controlsId ?? firstItemId ?? retryId,
    fromBelow: firstItemId ?? retryId ?? controlsId,
  };
}

function shouldShowScreenshotControls(state: ProfileScreenshotsState) {
  return (
    !state.hiddenReason &&
    (state.games.length > 0 || state.isFiltered || state.items.length > 0)
  );
}

interface ProfileScreenshotsEmptyStateProps {
  hiddenReason: ScreenshotsHiddenReason;
  isLoading: boolean;
  isOwnProfile: boolean;
  isFiltered: boolean;
  hotkey: ScreenshotHotkeyBinding | undefined;
}

interface EmptyStateCopy {
  title: string;
  description: string | null;
  hotkey?: string;
}

function getEmptyStateCopy({
  hiddenReason,
  isLoading,
  isOwnProfile,
  isFiltered,
  hotkey,
}: ProfileScreenshotsEmptyStateProps): EmptyStateCopy {
  if (isLoading) return { title: "screenshots_loading", description: null };
  if (hiddenReason === "FRIENDS_ONLY")
    return { title: "screenshots_hidden_friends", description: null };
  if (hiddenReason === "PRIVATE")
    return { title: "screenshots_hidden_private", description: null };
  if (isFiltered)
    return { title: "screenshots_empty_filtered", description: null };
  if (isOwnProfile)
    return {
      title: "screenshots_empty_own",
      description: "screenshots_empty_own_hint",
      hotkey: formatScreenshotHotkey(hotkey ?? DEFAULT_SCREENSHOT_HOTKEY),
    };

  return { title: "screenshots_empty_other", description: null };
}

function ProfileScreenshotsEmptyState(
  props: Readonly<ProfileScreenshotsEmptyStateProps>
) {
  const { t } = useTranslation("big_picture");
  const copy = getEmptyStateCopy(props);

  return (
    <div className="profile-page__screenshots-empty-state">
      <ImagesIcon size={36} />
      <div>
        <Typography className="profile-page__screenshots-empty-title">
          {t(copy.title)}
        </Typography>
        {copy.description ? (
          <Typography className="profile-page__screenshots-empty-description">
            {t(copy.description, { hotkey: copy.hotkey })}
          </Typography>
        ) : null}
      </div>
    </div>
  );
}

interface ProfileScreenshotsProps {
  state: ProfileScreenshotsState;
  isOwnProfile: boolean;
  hotkey: ScreenshotHotkeyBinding | undefined;
  upFocusId: string | null;
  downFocusId: string | null;
  onActivate: (screenshot: ProfileScreenshot) => void;
}

const toTarget = (focusId: string | null): FocusOverrideTarget =>
  focusId ? { type: "item", itemId: focusId } : { type: "block" };

export function ProfileScreenshots({
  state,
  isOwnProfile,
  hotkey,
  upFocusId,
  downFocusId,
  onActivate,
}: Readonly<ProfileScreenshotsProps>) {
  const cardLike = useScreenshotCardLike(state.updateItem, state.removeItem);
  const { t } = useTranslation("big_picture");
  const showControls = shouldShowScreenshotControls(state);
  const firstItem = state.items[0];
  const firstItemFocusId = firstItem
    ? getProfileScreenshotItemId(firstItem.id)
    : null;
  const count = state.isFiltered
    ? (state.overallTotal ?? state.total)
    : (state.total ?? state.overallTotal);

  const filterOptions = useMemo<DropdownSelectOption[]>(
    () => [
      { value: ALL_GAMES_FILTER, label: t("screenshots_filter_all_games") },
      ...state.games.map((game) => ({
        value: getScreenshotFilterKey(game),
        label: t("screenshots_filter_game", {
          title: game.title ?? t("screenshots_custom_game"),
          count: game.count,
        }),
      })),
    ],
    [state.games, t]
  );

  const sortOptions = useMemo<DropdownSelectOption<ScreenshotSort>[]>(
    () => [
      { value: "recent", label: t("screenshots_sort_recent") },
      { value: "top", label: t("screenshots_sort_top") },
    ],
    [t]
  );

  const controlsNavigation = {
    up: toTarget(upFocusId),
    down: toTarget(
      firstItemFocusId ??
        (state.error === "initial" ? PROFILE_SCREENSHOTS_RETRY_ID : null) ??
        downFocusId
    ),
  };

  if (!state.isEnabled) return null;

  return (
    <section className="profile-page__screenshots-section">
      <header className="profile-page__screenshots-header">
        <div className="profile-page__screenshots-heading">
          <Typography className="profile-page__screenshots-title">
            {t("screenshots_title")}
          </Typography>
          {count ? (
            <Typography className="profile-page__screenshots-count">
              {count}
            </Typography>
          ) : null}
        </div>

        {showControls ? (
          <HorizontalFocusGroup
            regionId={PROFILE_SCREENSHOTS_CONTROLS_REGION_ID}
            className="profile-page__screenshots-controls"
          >
            <DropdownSelect
              className="profile-page__screenshots-select"
              label={t("screenshots_filter_label")}
              hideLabel
              ariaLabel={t("screenshots_filter_label")}
              value={state.filterKey}
              options={filterOptions}
              focusId={PROFILE_SCREENSHOTS_FILTER_ID}
              focusNavigationOverrides={{
                ...controlsNavigation,
                left: { type: "item", itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID },
                right: { type: "item", itemId: PROFILE_SCREENSHOTS_SORT_ID },
              }}
              onValueChange={state.setFilterKey}
            />
            <DropdownSelect
              className="profile-page__screenshots-select"
              label={t("screenshots_sort_label")}
              hideLabel
              leadingIcon={<SortAscendingIcon size={20} />}
              ariaLabel={t("screenshots_sort_label")}
              value={state.sort}
              options={sortOptions}
              focusId={PROFILE_SCREENSHOTS_SORT_ID}
              focusNavigationOverrides={{
                ...controlsNavigation,
                left: { type: "item", itemId: PROFILE_SCREENSHOTS_FILTER_ID },
                right: { type: "block" },
              }}
              onValueChange={state.setSort}
            />
          </HorizontalFocusGroup>
        ) : null}
      </header>

      {state.items.length > 0 ? (
        <ScreenshotRow
          regionId={PROFILE_SCREENSHOTS_REGION_ID}
          items={state.items}
          getItemFocusId={(screenshot) =>
            getProfileScreenshotItemId(screenshot.id)
          }
          showOwnerDetails={isOwnProfile}
          showAuthor={false}
          hasMore={state.hasMore}
          isLoadingMore={state.isLoadingMore}
          upTarget={toTarget(
            showControls ? PROFILE_SCREENSHOTS_FILTER_ID : upFocusId
          )}
          downTarget={toTarget(downFocusId)}
          leftTarget={{ type: "item", itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID }}
          hasLoadMoreError={state.error === "page"}
          retryFocusId={PROFILE_SCREENSHOTS_LOAD_MORE_RETRY_ID}
          onRetryLoadMore={state.retry}
          onLoadMore={() => void state.loadMore()}
          likingIds={cardLike.likingIds}
          onActivate={onActivate}
          onLike={(screenshot) => void cardLike.toggleLike(screenshot)}
          onRefreshImage={state.refreshImage}
        />
      ) : null}

      {state.items.length === 0 && state.error === "initial" ? (
        <div className="profile-page__screenshots-empty-state">
          <WarningCircleIcon size={36} />
          <div className="profile-page__screenshots-error">
            <Typography className="profile-page__screenshots-empty-title">
              {t("screenshots_load_failed")}
            </Typography>
            <Button
              variant="secondary"
              size="small"
              focusId={PROFILE_SCREENSHOTS_RETRY_ID}
              icon={<ArrowClockwiseIcon size={18} />}
              focusNavigationOverrides={{
                up: toTarget(
                  showControls ? PROFILE_SCREENSHOTS_FILTER_ID : upFocusId
                ),
                down: toTarget(downFocusId),
                left: { type: "item", itemId: BIG_PICTURE_SIDEBAR_PROFILE_ID },
                right: { type: "block" },
              }}
              onClick={state.retry}
            >
              {t("screenshots_retry")}
            </Button>
          </div>
        </div>
      ) : null}

      {state.items.length === 0 && state.error !== "initial" ? (
        <ProfileScreenshotsEmptyState
          hiddenReason={state.hiddenReason}
          isLoading={state.isLoading}
          isOwnProfile={isOwnProfile}
          isFiltered={state.isFiltered}
          hotkey={hotkey}
        />
      ) : null}
    </section>
  );
}
