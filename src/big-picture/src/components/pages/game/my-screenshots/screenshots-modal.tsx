import {
  ArrowClockwiseIcon,
  ClockCounterClockwiseIcon,
  FireIcon,
  ImageIcon,
  UsersThreeIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  GameShop,
  LocalScreenshot,
  ProfileScreenshot,
  ScreenshotSort,
} from "@types";
import {
  groupByCaptureDay,
  INITIAL_SCREENSHOT_SPOILER_PAGING,
  buildGameScreenshotsPath,
  resumeSpoilerPaging,
  shouldAutoLoadSpoilerPage,
  trackSpoilerPaging,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";
import { useCaptureDayLabel } from "@renderer/pages/game-details/game-screenshots/screenshot-date-groups";

import {
  BumperBadge,
  Button,
  Checkbox,
  GridFocusGroup,
  HorizontalFocusGroup,
  Modal,
  SegmentedControl,
  Skeleton,
  Tabs,
  VerticalFocusGroup,
  type SegmentedControlOption,
  type TabsItem,
} from "../../../common";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  useScreenshotCardLike,
  useScreenshotFeed,
  useScreenshotLightbox,
  type ScreenshotViewerEntry,
} from "../../screenshots";
import { FocusRegionContext, useFocusLayerId } from "../../../context";
import { useGamepad, useNavigation, useUserDetails } from "../../../../hooks";
import { NavigationService } from "../../../../services";
import {
  GamepadButtonType,
  type GamepadButtonPressEvent,
} from "../../../../types";
import {
  GAME_SCREENSHOTS_MODAL_BROWSE_COMMUNITY_ID,
  GAME_SCREENSHOTS_MODAL_CLOSE_ID,
  GAME_SCREENSHOTS_MODAL_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_LIST_REGION_ID,
  GAME_SCREENSHOTS_MODAL_LOAD_MORE_ID,
  GAME_SCREENSHOTS_MODAL_MINE_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_MINE_LOAD_MORE_ID,
  GAME_SCREENSHOTS_MODAL_MINE_RETRY_ID,
  GAME_SCREENSHOTS_MODAL_REGION_ID,
  GAME_SCREENSHOTS_MODAL_RETRY_ID,
  GAME_SCREENSHOTS_MODAL_SORT_ID,
  GAME_SCREENSHOTS_MODAL_SPOILERS_ID,
  GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID,
  getGameScreenshotsModalItemId,
} from "../navigation";
import { ScreenshotHotkeyHint } from "./hotkey-hint";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { MyScreenshotsPartialNotice } from "./partial-notice";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import { useMyScreenshotsViewer } from "./use-my-screenshots-viewer";
import {
  useFocusFollowsPublishedLocal,
  useMyGameScreenshotsState,
  useMyPublishedScreenshots,
  usePendingLocalScreenshots,
} from "./use-my-game-screenshots";

const SORT_STORAGE_KEY = "big-picture:game-screenshots-sort";
const MODAL_PAGE_SIZE = 24;
const SKELETON_CARD_COUNT = 6;

function readStoredSort(): ScreenshotSort {
  try {
    return globalThis.window.localStorage.getItem(SORT_STORAGE_KEY) === "top"
      ? "top"
      : "recent";
  } catch {
    return "recent";
  }
}

function storeSort(sort: ScreenshotSort) {
  try {
    globalThis.window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch (error) {
    logger.warn("Failed to remember screenshot sort", error);
  }
}

const hideSpoilerScreenshots = (
  items: ProfileScreenshot[],
  hideSpoilers: boolean
) => (hideSpoilers ? items.filter((item) => !item.isSpoiler) : items);

function useScreenshotSortOptions() {
  const { t } = useTranslation("big_picture");

  return useMemo<SegmentedControlOption<ScreenshotSort>[]>(
    () => [
      {
        value: "recent",
        label: (
          <span className="game-screenshots-modal__sort-option">
            <ClockCounterClockwiseIcon size={16} weight="bold" />
            {t("screenshots_sort_recent")}
          </span>
        ),
      },
      {
        value: "top",
        label: (
          <span className="game-screenshots-modal__sort-option">
            <FireIcon size={16} weight="bold" />
            {t("screenshots_sort_top")}
          </span>
        ),
      },
    ],
    [t]
  );
}

function ScreenshotSkeletonGrid() {
  return (
    <ul className="game-screenshots-modal__list" aria-busy="true">
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
        <li
          key={`game-screenshots-skeleton-${index}`}
          className="game-screenshots-modal__skeleton-card"
        >
          <Skeleton className="game-screenshots-modal__skeleton" />
        </li>
      ))}
    </ul>
  );
}

interface LoadMoreButtonProps {
  focusId: string;
  isLoading: boolean;
  hasError: boolean;
  navigationOrder?: number;
  onPress: () => void;
}

function LoadMoreButton({
  focusId,
  isLoading,
  hasError,
  navigationOrder,
  onPress,
}: Readonly<LoadMoreButtonProps>) {
  const { t } = useTranslation("big_picture");

  return (
    <Button
      variant="secondary"
      size="small"
      focusId={focusId}
      focusNavigationOrder={navigationOrder}
      className="game-screenshots-modal__load-more"
      loading={isLoading}
      onClick={onPress}
    >
      {t(hasError ? "screenshots_retry" : "screenshots_load_more")}
    </Button>
  );
}

interface ScreenshotsSourceOptions {
  enabled: boolean;
  shop: GameShop;
  objectId: string;
  writeBus?: ScreenshotWriteBus;
}

function useCommunityScreenshots({
  enabled,
  shop,
  objectId,
  writeBus,
}: ScreenshotsSourceOptions) {
  const { userDetails } = useUserDetails();
  const [sort, setSort] = useState<ScreenshotSort>(readStoredSort);
  const [hideSpoilers, setHideSpoilers] = useState(false);
  const isSignedIn = Boolean(userDetails);

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildGameScreenshotsPath({
        shop,
        objectId,
        cursor,
        sort,
        take: MODAL_PAGE_SIZE,
      }),
    [objectId, shop, sort]
  );

  const feed = useScreenshotFeed({
    requestKey: enabled ? `${shop}:${objectId}:${sort}:all` : null,
    buildPath,
    needsAuth: isSignedIn,
    writeBus,
  });
  const visibleItems = useMemo(
    () => hideSpoilerScreenshots(feed.items, hideSpoilers),
    [feed.items, hideSpoilers]
  );
  const { lightboxProps, open } = useScreenshotLightbox({
    items: visibleItems,
    needsAuth: isSignedIn,
    updateItem: feed.updateItem,
    removeItem: feed.removeItem,
    getFetchedAt: feed.getFetchedAt,
    imageRefresher: feed.imageRefresher,
    subscribeRemoteWrites: feed.subscribeRemoteWrites,
    hasMore: feed.hasMore,
    loadMore: feed.loadMore,
    hasLoadMoreError: feed.error === "page",
    retryLoadMore: feed.retry,
  });
  const canLoadMore =
    feed.hasMore && !feed.isLoadingMore && feed.error !== "page";
  const { loadMore } = feed;

  const requestMore = useCallback(() => {
    loadMore().catch((error: unknown) => {
      logger.error("Failed to load more game screenshots", error);
    });
  }, [loadMore]);

  const spoilerPagingRef = useRef(INITIAL_SCREENSHOT_SPOILER_PAGING);
  const loadedCount = feed.items.length;
  const visibleCount = visibleItems.length;

  useEffect(() => {
    const paging = trackSpoilerPaging(
      spoilerPagingRef.current,
      loadedCount,
      visibleCount
    );
    spoilerPagingRef.current = paging;

    if (shouldAutoLoadSpoilerPage({ hideSpoilers, canLoadMore, paging })) {
      requestMore();
    }
  }, [canLoadMore, hideSpoilers, loadedCount, requestMore, visibleCount]);

  const loadNextPage = () => {
    if (feed.error === "page") {
      feed.retry();
      return;
    }

    spoilerPagingRef.current = resumeSpoilerPaging(spoilerPagingRef.current);
    requestMore();
  };

  const changeSort = (nextSort: ScreenshotSort) => {
    setSort(nextSort);
    storeSort(nextSort);
  };

  return {
    sort,
    changeSort,
    hideSpoilers,
    setHideSpoilers,
    feed,
    visibleItems,
    lightboxProps,
    open,
    loadNextPage,
  };
}

type CommunityScreenshots = ReturnType<typeof useCommunityScreenshots>;

function CommunityScreenshotsGrid({
  community,
}: Readonly<{ community: CommunityScreenshots }>) {
  const { t } = useTranslation("big_picture");
  const { feed, visibleItems, open } = community;
  const cardLike = useScreenshotCardLike(feed.updateItem, feed.removeItem);

  if (visibleItems.length > 0) {
    return (
      <GridFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_GRID_REGION_ID}
        className="game-screenshots-modal__grid"
      >
        <ul className="game-screenshots-modal__list game-screenshots-modal__list--large">
          {visibleItems.map((screenshot) => (
            <ScreenshotCard
              key={screenshot.id}
              screenshot={screenshot}
              focusId={getGameScreenshotsModalItemId(screenshot.id)}
              showOwnerDetails={false}
              showAuthor
              metaPlacement="overlay"
              isLikePending={cardLike.likingIds.has(screenshot.id)}
              onActivate={open}
              onLike={(item) => void cardLike.toggleLike(item)}
              onRefreshImage={feed.refreshImage}
            />
          ))}
        </ul>
      </GridFocusGroup>
    );
  }

  if (feed.isLoading) return <ScreenshotSkeletonGrid />;

  if (feed.error === "initial") {
    return (
      <div className="game-screenshots-modal__message">
        <p>{t("screenshots_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_SCREENSHOTS_MODAL_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          onClick={feed.retry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="game-screenshots-modal__message">
      <ImageIcon size={28} />
      <p>
        {t(
          feed.items.length > 0
            ? "screenshots_all_spoilers"
            : "screenshots_empty_other"
        )}
      </p>
    </div>
  );
}

function CommunityScreenshotsPanel({
  community,
}: Readonly<{ community: CommunityScreenshots }>) {
  const { t } = useTranslation("big_picture");
  const sortOptions = useScreenshotSortOptions();
  const { feed } = community;

  return (
    <>
      <HorizontalFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID}
        navigationOrder={0}
        asChild
      >
        <div className="game-screenshots-modal__toolbar">
          <Checkbox
            label={t("screenshots_hide_spoilers")}
            checked={community.hideSpoilers}
            focusId={GAME_SCREENSHOTS_MODAL_SPOILERS_ID}
            onChange={community.setHideSpoilers}
          />
          <div className="game-screenshots-modal__sort">
            <SegmentedControl
              ariaLabel={t("screenshots_sort_label")}
              value={community.sort}
              options={sortOptions}
              focusId={GAME_SCREENSHOTS_MODAL_SORT_ID}
              onValueChange={community.changeSort}
            />
          </div>
        </div>
      </HorizontalFocusGroup>

      <VerticalFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_LIST_REGION_ID}
        navigationOrder={1}
        asChild
      >
        <div className="game-screenshots-modal__scroll">
          <CommunityScreenshotsGrid community={community} />

          {feed.hasMore && feed.items.length > 0 ? (
            <LoadMoreButton
              focusId={GAME_SCREENSHOTS_MODAL_LOAD_MORE_ID}
              isLoading={feed.isLoadingMore}
              hasError={feed.error === "page"}
              onPress={community.loadNextPage}
            />
          ) : null}
        </div>
      </VerticalFocusGroup>
    </>
  );
}

type MyScreenshotsEntry =
  | { kind: "local"; time: number; screenshot: LocalScreenshot }
  | { kind: "uploaded"; time: number; screenshot: ProfileScreenshot };

const toViewerEntry = (entry: MyScreenshotsEntry): ScreenshotViewerEntry =>
  entry.kind === "local"
    ? { kind: "local", screenshot: entry.screenshot }
    : { kind: "uploaded", screenshot: entry.screenshot };

const getLocalEntryFocusId = (clientId: string) =>
  getGameScreenshotsModalItemId(`mine-local:${clientId}`);

const getUploadedEntryFocusId = (screenshotId: string) =>
  getGameScreenshotsModalItemId(`mine-${screenshotId}`);

const getEntryFocusId = (entry: MyScreenshotsEntry) =>
  entry.kind === "local"
    ? getLocalEntryFocusId(entry.screenshot.clientId)
    : getUploadedEntryFocusId(entry.screenshot.id);

interface MyScreenshotsTabOptions extends ScreenshotsSourceOptions {
  emptyFocusId: string;
}

function useMyScreenshotsTab({
  enabled,
  shop,
  objectId,
  writeBus,
  emptyFocusId,
}: MyScreenshotsTabOptions) {
  const pendingLocal = usePendingLocalScreenshots(shop, objectId, enabled);
  const published = useMyPublishedScreenshots({
    shop,
    objectId,
    sort: "recent",
    take: MODAL_PAGE_SIZE,
    isEnabled: enabled,
    writeBus,
    feedKeySuffix: "all",
  });
  const mine = useMyGameScreenshotsState({
    local: pendingLocal,
    published,
    sort: "recent",
    isEnabled: enabled,
  });
  const { feed } = mine;
  useFocusFollowsPublishedLocal(
    mine.pendingLocal,
    feed.items.map((item) => item.id),
    getLocalEntryFocusId,
    getUploadedEntryFocusId
  );
  const local = useLocalScreenshotActions();
  const { lightboxProps, open, close } = useScreenshotLightbox({
    items: feed.items,
    needsAuth: true,
    updateItem: feed.updateItem,
    removeItem: feed.removeItem,
    getFetchedAt: feed.getFetchedAt,
    imageRefresher: feed.imageRefresher,
    subscribeRemoteWrites: feed.subscribeRemoteWrites,
    hasMore: feed.hasMore,
    loadMore: feed.loadMore,
    hasLoadMoreError: feed.error === "page",
    retryLoadMore: feed.retry,
  });

  const uploadedItems = mine.canFetchPublished ? feed.items : [];
  const hasMoreUploaded = mine.canFetchPublished && feed.hasMore;
  const oldestLoadedUpload = uploadedItems.at(-1)?.capturedAt ?? null;
  const entries: MyScreenshotsEntry[] = [
    ...mine.pendingLocal
      .filter(
        (screenshot) =>
          !hasMoreUploaded ||
          oldestLoadedUpload === null ||
          screenshot.capturedAt >= oldestLoadedUpload
      )
      .map((screenshot) => ({
        kind: "local" as const,
        time: screenshot.capturedAt,
        screenshot,
      })),
    ...uploadedItems.map((screenshot) => ({
      kind: "uploaded" as const,
      time: screenshot.capturedAt,
      screenshot,
    })),
  ].toSorted((a, b) => b.time - a.time);
  const getFocusAfterLocalDeleteId = (screenshot: LocalScreenshot) => {
    const index = entries.findIndex(
      (entry) =>
        entry.kind === "local" &&
        entry.screenshot.clientId === screenshot.clientId
    );
    const neighbour =
      index === -1 ? undefined : (entries[index + 1] ?? entries[index - 1]);
    if (neighbour) return getEntryFocusId(neighbour);

    return mine.isPartial ? GAME_SCREENSHOTS_MODAL_MINE_RETRY_ID : emptyFocusId;
  };
  const viewer = useMyScreenshotsViewer({
    entries: entries.map(toViewerEntry),
    localScreenshots: mine.localScreenshots,
    hasLocalLoaded: mine.hasLoadedLocal,
    uploadedItems,
    canResolveUploaded: mine.canFetchPublished,
    openUploaded: open,
    closeUploaded: close,
    getFocusAfterLocalDeleteId,
  });
  const isLoading =
    !mine.hasLoadedLocal || (mine.canFetchPublished && feed.isLoading);

  const loadNextPage = () => {
    if (feed.error === "page") {
      feed.retry();
      return;
    }

    feed.loadMore().catch((error: unknown) => {
      logger.error("Failed to load more of my game screenshots", error);
    });
  };

  return {
    mine,
    local,
    entries,
    isLoading,
    hasMoreUploaded,
    firstFocusId: entries[0] ? getEntryFocusId(entries[0]) : undefined,
    lightboxProps: { ...lightboxProps, localSlot: viewer.localSlot },
    openEntry: viewer.openEntry,
    getFocusAfterLocalDeleteId,
    loadNextPage,
  };
}

type MyScreenshotsTab = ReturnType<typeof useMyScreenshotsTab>;

interface MyScreenshotsMessageProps {
  tab: MyScreenshotsTab;
  hasFailed: boolean;
  onBrowseCommunity?: () => void;
  onClose: () => void;
}

function MyScreenshotsMessage({
  tab,
  hasFailed,
  onBrowseCommunity,
  onClose,
}: Readonly<MyScreenshotsMessageProps>) {
  const { t } = useTranslation("big_picture");

  if (hasFailed) {
    return (
      <div className="game-screenshots-modal__message">
        <p>
          {t(
            tab.mine.hasLocalFailed
              ? "local_screenshots_load_failed"
              : "published_screenshots_load_failed",
            { ns: "screenshots" }
          )}
        </p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_SCREENSHOTS_MODAL_MINE_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          onClick={tab.mine.retryFailed}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="game-screenshots-modal__message">
      <ImageIcon size={28} />
      <p>{t("screenshots_empty_filtered")}</p>
      <ScreenshotHotkeyHint className="game-screenshots-modal__hint" />
      {onBrowseCommunity ? (
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_SCREENSHOTS_MODAL_BROWSE_COMMUNITY_ID}
          icon={<UsersThreeIcon size={18} />}
          onClick={onBrowseCommunity}
        >
          {t("screenshots_browse_community")}
        </Button>
      ) : (
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_SCREENSHOTS_MODAL_CLOSE_ID}
          icon={<XIcon size={18} />}
          onClick={onClose}
        >
          {t("screenshots_close")}
        </Button>
      )}
    </div>
  );
}

interface MyScreenshotsListProps {
  tab: MyScreenshotsTab;
  onBrowseCommunity?: () => void;
  onClose: () => void;
}

function MyScreenshotsList({
  tab,
  onBrowseCommunity,
  onClose,
}: Readonly<MyScreenshotsListProps>) {
  const { mine, local, entries, openEntry } = tab;
  const { feed } = mine;
  const cardLike = useScreenshotCardLike(feed.updateItem, feed.removeItem);
  const getDayLabel = useCaptureDayLabel();

  if (mine.hasFailed) {
    return <MyScreenshotsMessage tab={tab} hasFailed onClose={onClose} />;
  }
  if (tab.isLoading) return <ScreenshotSkeletonGrid />;

  const partialNotice = (
    <MyScreenshotsPartialNotice
      mine={mine}
      focusId={GAME_SCREENSHOTS_MODAL_MINE_RETRY_ID}
      className="game-screenshots-modal__notice"
      navigationOrder={-1}
    />
  );

  if (entries.length === 0) {
    if (mine.isPartial) return partialNotice;
    return (
      <MyScreenshotsMessage
        tab={tab}
        hasFailed={false}
        onBrowseCommunity={onBrowseCommunity}
        onClose={onClose}
      />
    );
  }

  const renderEntry = (entry: MyScreenshotsEntry) => {
    if (entry.kind === "uploaded") {
      return (
        <ScreenshotCard
          key={entry.screenshot.id}
          screenshot={entry.screenshot}
          focusId={getEntryFocusId(entry)}
          showOwnerDetails
          showAuthor={false}
          metaPlacement="none"
          isLikePending={cardLike.likingIds.has(entry.screenshot.id)}
          onActivate={(item) =>
            openEntry({ kind: "uploaded", screenshot: item })
          }
          onLike={(item) => void cardLike.toggleLike(item)}
          onRefreshImage={feed.refreshImage}
        />
      );
    }

    const { screenshot } = entry;
    return (
      <li
        key={screenshot.clientId}
        className="game-screenshots-modal__local-item"
      >
        <LocalScreenshotTile
          screenshot={screenshot}
          focusId={getEntryFocusId(entry)}
          alt={local.describe(screenshot)}
          isBusy={local.busyIds.has(screenshot.clientId)}
          variant="card"
          onOpen={(item) => openEntry({ kind: "local", screenshot: item })}
          onDelete={(item) =>
            local.requestDelete(item, tab.getFocusAfterLocalDeleteId(item))
          }
        />
      </li>
    );
  };

  const dayGroups = groupByCaptureDay(entries, (entry) => entry.time);

  return (
    <>
      {partialNotice}
      {dayGroups.map((group, index) => (
        <section key={group.key} className="game-screenshots-modal__day">
          <h3 className="game-screenshots-modal__day-title">
            {getDayLabel(group.dayStart)}
          </h3>
          <GridFocusGroup
            regionId={`${GAME_SCREENSHOTS_MODAL_MINE_GRID_REGION_ID}:${group.key}`}
            navigationOrder={index}
            className="game-screenshots-modal__grid"
          >
            <ul className="game-screenshots-modal__list">
              {group.items.map(renderEntry)}
            </ul>
          </GridFocusGroup>
        </section>
      ))}
      {tab.hasMoreUploaded ? (
        <LoadMoreButton
          focusId={GAME_SCREENSHOTS_MODAL_MINE_LOAD_MORE_ID}
          isLoading={feed.isLoadingMore}
          hasError={feed.error === "page"}
          navigationOrder={dayGroups.length}
          onPress={tab.loadNextPage}
        />
      ) : null}
    </>
  );
}

function MyScreenshotsPanel({
  tab,
  onBrowseCommunity,
  onClose,
}: Readonly<MyScreenshotsListProps>) {
  return (
    <VerticalFocusGroup
      regionId={GAME_SCREENSHOTS_MODAL_LIST_REGION_ID}
      navigationOrder={0}
      asChild
    >
      <div className="game-screenshots-modal__scroll">
        <MyScreenshotsList
          tab={tab}
          onBrowseCommunity={onBrowseCommunity}
          onClose={onClose}
        />
      </div>
    </VerticalFocusGroup>
  );
}

export type GameScreenshotsTab = "mine" | "community";

const TAB_ORDER: GameScreenshotsTab[] = ["mine", "community"];

function TabBumperFallback({
  activeTab,
  onSelect,
}: Readonly<{
  activeTab: GameScreenshotsTab;
  onSelect: (tab: GameScreenshotsTab) => void;
}>) {
  const layerId = useFocusLayerId();
  const { onButtonPressed, isActiveGamepadEvent } = useGamepad();

  useEffect(() => {
    const navigation = NavigationService.getInstance();
    const isFocusOutsideLayer = () => {
      const focusId = navigation.getCurrentFocusId();
      return !focusId || navigation.getNode(focusId)?.layerId !== layerId;
    };
    const step = (direction: -1 | 1) => (event: GamepadButtonPressEvent) => {
      if (!isActiveGamepadEvent(event)) return;
      if (navigation.getActiveLayerId() !== layerId) return;
      if (!isFocusOutsideLayer()) return;
      const next = TAB_ORDER[TAB_ORDER.indexOf(activeTab) + direction];
      if (next) onSelect(next);
    };
    const removeLeft = onButtonPressed(GamepadButtonType.LEFT_BUMPER, step(-1));
    const removeRight = onButtonPressed(
      GamepadButtonType.RIGHT_BUMPER,
      step(1)
    );
    return () => {
      removeLeft();
      removeRight();
    };
  }, [activeTab, isActiveGamepadEvent, layerId, onButtonPressed, onSelect]);

  return null;
}

export interface GameScreenshotsModalProps {
  visible: boolean;
  shop: GameShop;
  objectId: string;
  communityShop: GameShop;
  communityObjectId: string;
  writeBus?: ScreenshotWriteBus;
  initialTab?: GameScreenshotsTab;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  shop,
  objectId,
  communityShop,
  communityObjectId,
  writeBus,
  initialTab = "mine",
  onClose,
}: Readonly<GameScreenshotsModalProps>) {
  const { t } = useTranslation("screenshots");
  const { setFocus } = useNavigation();
  const [tab, setTab] = useState<GameScreenshotsTab>(initialTab);
  const [hasOpenedCommunity, setHasOpenedCommunity] = useState(false);
  const hasCommunity = communityShop !== "custom";
  const activeTab = hasCommunity ? tab : "mine";
  const emptyMineFocusId = hasCommunity
    ? GAME_SCREENSHOTS_MODAL_BROWSE_COMMUNITY_ID
    : GAME_SCREENSHOTS_MODAL_CLOSE_ID;
  const mineTab = useMyScreenshotsTab({
    enabled: visible,
    shop,
    objectId,
    writeBus,
    emptyFocusId: emptyMineFocusId,
  });
  const community = useCommunityScreenshots({
    enabled: visible && hasCommunity && hasOpenedCommunity,
    shop: communityShop,
    objectId: communityObjectId,
    writeBus,
  });
  const tabItems = useMemo<TabsItem<GameScreenshotsTab>[]>(
    () => [
      { value: "mine", label: t("my_screenshots") },
      { value: "community", label: t("community_screenshots_tab") },
    ],
    [t]
  );

  useEffect(() => {
    if (!visible) return;
    if (initialTab === "community") setHasOpenedCommunity(true);
    setTab(initialTab);
  }, [initialTab, visible]);

  const mineFocusId = mineTab.firstFocusId ?? emptyMineFocusId;
  const [mineInitialFocusId, setMineInitialFocusId] = useState<string>();
  const isMineReady = activeTab === "mine" && !mineTab.isLoading;

  useEffect(() => {
    if (!visible) {
      setMineInitialFocusId(undefined);
      return;
    }
    if (isMineReady) {
      setMineInitialFocusId((current) => current ?? mineFocusId);
    }
  }, [isMineReady, mineFocusId, visible]);

  const selectTab = useCallback(
    (nextTab: GameScreenshotsTab) => {
      if (nextTab === "community") setHasOpenedCommunity(true);
      setTab(nextTab);
      globalThis.window.requestAnimationFrame(() =>
        setFocus(
          nextTab === "mine" ? mineFocusId : GAME_SCREENSHOTS_MODAL_SORT_ID
        )
      );
    },
    [mineFocusId, setFocus]
  );

  return (
    <>
      <Modal
        visible={visible}
        title={t("tab_title")}
        onClose={onClose}
        className="game-screenshots-modal"
        ariaLabel={t("tab_title")}
        headerContent={
          hasCommunity ? (
            <FocusRegionContext.Provider
              value={GAME_SCREENSHOTS_MODAL_REGION_ID}
            >
              <div className="game-screenshots-modal__tabs">
                <BumperBadge label="LB" />
                <Tabs
                  items={tabItems}
                  value={activeTab}
                  onValueChange={selectTab}
                  manageFocusRegion={false}
                  itemsFocusable={false}
                  ariaLabel={t("tab_title")}
                />
                <BumperBadge label="RB" />
              </div>
            </FocusRegionContext.Provider>
          ) : undefined
        }
        initialFocusId={mineInitialFocusId}
      >
        <VerticalFocusGroup regionId={GAME_SCREENSHOTS_MODAL_REGION_ID} asChild>
          <div className="game-screenshots-modal__content">
            {hasCommunity ? (
              <TabBumperFallback activeTab={activeTab} onSelect={selectTab} />
            ) : null}
            {activeTab === "mine" ? (
              <MyScreenshotsPanel
                tab={mineTab}
                onBrowseCommunity={
                  hasCommunity ? () => selectTab("community") : undefined
                }
                onClose={onClose}
              />
            ) : (
              <CommunityScreenshotsPanel community={community} />
            )}
          </div>
        </VerticalFocusGroup>
      </Modal>

      <ScreenshotLightbox {...mineTab.lightboxProps} />
      <ScreenshotLightbox {...community.lightboxProps} />
      {mineTab.local.elements}
    </>
  );
}
