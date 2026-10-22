import {
  ArrowClockwiseIcon,
  ImageIcon,
  SortAscendingIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ProfileScreenshot, ScreenshotSort } from "@types";
import {
  INITIAL_SCREENSHOT_SPOILER_PAGING,
  buildGameScreenshotsPath,
  resumeSpoilerPaging,
  shouldAutoLoadSpoilerPage,
  trackSpoilerPaging,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";

import {
  BumperBadge,
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  HorizontalFocusGroup,
  Modal,
  Skeleton,
  Tabs,
  VerticalFocusGroup,
  type DropdownSelectOption,
  type TabsItem,
} from "../../../common";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  useScreenshotFeed,
  useScreenshotLightbox,
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
  GAME_SCREENSHOTS_MODAL_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_LIST_REGION_ID,
  GAME_SCREENSHOTS_MODAL_LOAD_MORE_ID,
  GAME_SCREENSHOTS_MODAL_LOCAL_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_MINE_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_MINE_LOAD_MORE_ID,
  GAME_SCREENSHOTS_MODAL_MINE_RETRY_ID,
  GAME_SCREENSHOTS_MODAL_MINE_LOCAL_ID,
  GAME_SCREENSHOTS_MODAL_MINE_SORT_ID,
  GAME_SCREENSHOTS_MODAL_MINE_UPLOADED_ID,
  GAME_SCREENSHOTS_MODAL_REGION_ID,
  GAME_SCREENSHOTS_MODAL_RETRY_ID,
  GAME_SCREENSHOTS_MODAL_SORT_ID,
  GAME_SCREENSHOTS_MODAL_SPOILERS_ID,
  GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID,
  getGameScreenshotsModalItemId,
} from "../navigation";
import { ScreenshotHotkeyHint } from "./hotkey-hint";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import {
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

  return useMemo<DropdownSelectOption<ScreenshotSort>[]>(
    () => [
      { value: "recent", label: t("screenshots_sort_recent") },
      { value: "top", label: t("screenshots_sort_top") },
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
  onPress: () => void;
}

function LoadMoreButton({
  focusId,
  isLoading,
  hasError,
  onPress,
}: Readonly<LoadMoreButtonProps>) {
  const { t } = useTranslation("big_picture");

  return (
    <Button
      variant="secondary"
      size="small"
      focusId={focusId}
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
  const canLoadMore = feed.hasMore && !feed.isLoadingMore && !feed.error;
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

  if (visibleItems.length > 0) {
    return (
      <GridFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_GRID_REGION_ID}
        className="game-screenshots-modal__grid"
      >
        <ul className="game-screenshots-modal__list">
          {visibleItems.map((screenshot) => (
            <ScreenshotCard
              key={screenshot.id}
              screenshot={screenshot}
              focusId={getGameScreenshotsModalItemId(screenshot.id)}
              showOwnerDetails={false}
              showAuthor
              onActivate={open}
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
          <DropdownSelect
            className="game-screenshots-modal__sort"
            label={t("screenshots_sort_label")}
            hideLabel
            leadingIcon={<SortAscendingIcon size={20} />}
            ariaLabel={t("screenshots_sort_label")}
            value={community.sort}
            options={sortOptions}
            focusId={GAME_SCREENSHOTS_MODAL_SORT_ID}
            onValueChange={community.changeSort}
          />
          <Checkbox
            label={t("screenshots_hide_spoilers")}
            checked={community.hideSpoilers}
            focusId={GAME_SCREENSHOTS_MODAL_SPOILERS_ID}
            onChange={community.setHideSpoilers}
          />
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

type MyScreenshotsStatusFilter = "uploaded" | "local";

function useMyScreenshotsTab({
  enabled,
  shop,
  objectId,
  writeBus,
}: ScreenshotsSourceOptions) {
  const [sort, setSort] = useState<ScreenshotSort>("recent");
  const [hasOpenedTop, setHasOpenedTop] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<MyScreenshotsStatusFilter>("uploaded");
  const pendingLocal = usePendingLocalScreenshots(shop, objectId, enabled);
  const recent = useMyPublishedScreenshots({
    shop,
    objectId,
    sort: "recent",
    take: MODAL_PAGE_SIZE,
    isEnabled: enabled,
    writeBus,
    feedKeySuffix: "all",
  });
  const top = useMyPublishedScreenshots({
    shop,
    objectId,
    sort: "top",
    take: MODAL_PAGE_SIZE,
    isEnabled: enabled && hasOpenedTop,
    writeBus,
    feedKeySuffix: "all",
  });
  const active = sort === "top" ? top : recent;
  const inactive = sort === "top" ? recent : top;
  const mine = useMyGameScreenshotsState({
    local: pendingLocal,
    published: active,
    sort,
    isEnabled: enabled,
    refreshOtherPublished: inactive.feed.refresh,
  });
  const changeSort = (nextSort: ScreenshotSort) => {
    if (nextSort === "top") setHasOpenedTop(true);
    setSort(nextSort);
  };
  const { feed } = mine;
  const local = useLocalScreenshotActions(mine.pendingLocal);
  const { lightboxProps, open } = useScreenshotLightbox({
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
  const activeFilter: MyScreenshotsStatusFilter = mine.canFetchPublished
    ? statusFilter
    : "local";

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
    sort,
    setSort: changeSort,
    activeFilter,
    setStatusFilter,
    mine,
    local,
    lightboxProps,
    open,
    loadNextPage,
  };
}

type MyScreenshotsTab = ReturnType<typeof useMyScreenshotsTab>;

interface MyScreenshotsMessageProps {
  tab: MyScreenshotsTab;
  hasFailed: boolean;
  onBrowseCommunity?: () => void;
}

function MyScreenshotsMessage({
  tab,
  hasFailed,
  onBrowseCommunity,
}: Readonly<MyScreenshotsMessageProps>) {
  const { t } = useTranslation("big_picture");

  if (hasFailed) {
    return (
      <div className="game-screenshots-modal__message">
        <p>
          {t(
            tab.activeFilter === "local"
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
      ) : null}
    </div>
  );
}

interface MyScreenshotsListProps {
  tab: MyScreenshotsTab;
  onBrowseCommunity?: () => void;
}

function UploadedScreenshotsList({
  tab,
  onBrowseCommunity,
}: Readonly<MyScreenshotsListProps>) {
  const { mine, open, loadNextPage } = tab;
  const { feed } = mine;

  if (mine.hasPublishedFailed) {
    return <MyScreenshotsMessage tab={tab} hasFailed />;
  }
  if (feed.isLoading) return <ScreenshotSkeletonGrid />;
  if (feed.items.length === 0) {
    return (
      <MyScreenshotsMessage
        tab={tab}
        hasFailed={false}
        onBrowseCommunity={onBrowseCommunity}
      />
    );
  }

  return (
    <>
      <GridFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_MINE_GRID_REGION_ID}
        className="game-screenshots-modal__grid"
      >
        <ul className="game-screenshots-modal__list">
          {feed.items.map((screenshot) => (
            <ScreenshotCard
              key={screenshot.id}
              screenshot={screenshot}
              focusId={getGameScreenshotsModalItemId(`mine-${screenshot.id}`)}
              showOwnerDetails
              showAuthor={false}
              onActivate={open}
              onRefreshImage={feed.refreshImage}
            />
          ))}
        </ul>
      </GridFocusGroup>
      {feed.hasMore ? (
        <LoadMoreButton
          focusId={GAME_SCREENSHOTS_MODAL_MINE_LOAD_MORE_ID}
          isLoading={feed.isLoadingMore}
          hasError={feed.error === "page"}
          onPress={loadNextPage}
        />
      ) : null}
    </>
  );
}

function LocalScreenshotsList({
  tab,
  onBrowseCommunity,
}: Readonly<MyScreenshotsListProps>) {
  const { mine, local } = tab;

  if (mine.hasLocalFailed) {
    return <MyScreenshotsMessage tab={tab} hasFailed />;
  }
  if (!mine.hasLoadedLocal && mine.pendingLocal.length === 0) {
    return <ScreenshotSkeletonGrid />;
  }
  if (mine.pendingLocal.length === 0) {
    return (
      <MyScreenshotsMessage
        tab={tab}
        hasFailed={false}
        onBrowseCommunity={onBrowseCommunity}
      />
    );
  }

  return (
    <GridFocusGroup
      regionId={GAME_SCREENSHOTS_MODAL_LOCAL_GRID_REGION_ID}
      className="game-screenshots-modal__grid"
    >
      <ul className="game-screenshots-modal__list">
        {mine.pendingLocal.map((screenshot) => (
          <li
            key={screenshot.clientId}
            className="game-screenshots-modal__local-item"
          >
            <LocalScreenshotTile
              screenshot={screenshot}
              focusId={getGameScreenshotsModalItemId(
                `mine-local:${screenshot.clientId}`
              )}
              alt={local.describe(screenshot)}
              isBusy={local.busyIds.has(screenshot.clientId)}
              variant="card"
              onOpen={local.open}
              onUpload={local.upload}
              onDelete={local.requestDelete}
            />
          </li>
        ))}
      </ul>
    </GridFocusGroup>
  );
}

const STATUS_FILTER_FOCUS_IDS: Record<MyScreenshotsStatusFilter, string> = {
  uploaded: GAME_SCREENSHOTS_MODAL_MINE_UPLOADED_ID,
  local: GAME_SCREENSHOTS_MODAL_MINE_LOCAL_ID,
};

function MyScreenshotsPanel({
  tab,
  onBrowseCommunity,
}: Readonly<MyScreenshotsListProps>) {
  const { t } = useTranslation("big_picture");
  const sortOptions = useScreenshotSortOptions();
  const isLocal = tab.activeFilter === "local";
  const filters: { value: MyScreenshotsStatusFilter; label: string }[] = [
    { value: "uploaded", label: t("uploaded", { ns: "screenshots" }) },
    { value: "local", label: t("not_uploaded", { ns: "screenshots" }) },
  ];

  return (
    <>
      <HorizontalFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID}
        navigationOrder={0}
        asChild
      >
        <div className="game-screenshots-modal__toolbar">
          {tab.mine.canFetchPublished ? (
            <div
              className="game-screenshots-modal__status-filter"
              role="radiogroup"
              aria-label={t("screenshot_status_filter", { ns: "screenshots" })}
            >
              {filters.map((filter) => (
                <Button
                  key={filter.value}
                  variant={
                    tab.activeFilter === filter.value ? "primary" : "secondary"
                  }
                  size="small"
                  focusId={STATUS_FILTER_FOCUS_IDS[filter.value]}
                  role="radio"
                  aria-checked={tab.activeFilter === filter.value}
                  onClick={() => tab.setStatusFilter(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          ) : null}
          {isLocal ? null : (
            <DropdownSelect
              className="game-screenshots-modal__sort"
              label={t("screenshots_sort_label")}
              hideLabel
              leadingIcon={<SortAscendingIcon size={20} />}
              ariaLabel={t("screenshots_sort_label")}
              value={tab.sort}
              options={sortOptions}
              focusId={GAME_SCREENSHOTS_MODAL_MINE_SORT_ID}
              onValueChange={tab.setSort}
            />
          )}
        </div>
      </HorizontalFocusGroup>

      <VerticalFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_LIST_REGION_ID}
        navigationOrder={1}
        asChild
      >
        <div className="game-screenshots-modal__scroll">
          {isLocal ? (
            <LocalScreenshotsList
              tab={tab}
              onBrowseCommunity={onBrowseCommunity}
            />
          ) : (
            <UploadedScreenshotsList
              tab={tab}
              onBrowseCommunity={onBrowseCommunity}
            />
          )}
        </div>
      </VerticalFocusGroup>
    </>
  );
}

type GameScreenshotsTab = "mine" | "community";

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

const TAB_SORT_FOCUS_IDS: Record<GameScreenshotsTab, string> = {
  mine: GAME_SCREENSHOTS_MODAL_MINE_UPLOADED_ID,
  community: GAME_SCREENSHOTS_MODAL_SORT_ID,
};

export interface GameScreenshotsModalProps {
  visible: boolean;
  shop: GameShop;
  objectId: string;
  writeBus?: ScreenshotWriteBus;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  shop,
  objectId,
  writeBus,
  onClose,
}: Readonly<GameScreenshotsModalProps>) {
  const { t } = useTranslation("screenshots");
  const { setFocus } = useNavigation();
  const [tab, setTab] = useState<GameScreenshotsTab>("mine");
  const [hasOpenedCommunity, setHasOpenedCommunity] = useState(false);
  const hasCommunity = shop !== "custom";
  const activeTab = hasCommunity ? tab : "mine";
  const mineTab = useMyScreenshotsTab({
    enabled: visible,
    shop,
    objectId,
    writeBus,
  });
  const community = useCommunityScreenshots({
    enabled: visible && hasCommunity && hasOpenedCommunity,
    shop,
    objectId,
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
    if (visible) setTab("mine");
  }, [visible]);

  const selectTab = useCallback(
    (nextTab: GameScreenshotsTab) => {
      if (nextTab === "community") setHasOpenedCommunity(true);
      setTab(nextTab);
      globalThis.window.requestAnimationFrame(() =>
        setFocus(TAB_SORT_FOCUS_IDS[nextTab])
      );
    },
    [setFocus]
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
        initialFocusId={
          mineTab.mine.canFetchPublished
            ? GAME_SCREENSHOTS_MODAL_MINE_UPLOADED_ID
            : undefined
        }
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
