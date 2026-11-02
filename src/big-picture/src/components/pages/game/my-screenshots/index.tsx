import "./styles.scss";

import {
  ArrowClockwiseIcon,
  ImageIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, LocalScreenshot, ProfileScreenshot } from "@types";
import {
  buildGameScreenshotsPath,
  createScreenshotWriteBus,
  type MyScreenshotItem,
  type ScreenshotWriteBus,
} from "@shared";

import {
  Button,
  GridFocusGroup,
  Typography,
  VerticalFocusGroup,
} from "../../../common";
import {
  ScreenshotLightbox,
  useScreenshotFeed,
  useScreenshotLightbox,
  type ScreenshotViewerEntry,
} from "../../screenshots";
import { getItemFocusTarget } from "../../../../helpers";
import { Feature, useFeature, useUserDetails } from "../../../../hooks";
import {
  NavigationService,
  type FocusOverrides,
  type FocusOverrideTarget,
} from "../../../../services";
import {
  GAME_MY_SCREENSHOTS_GRID_REGION_ID,
  GAME_MY_SCREENSHOTS_REGION_ID,
  GAME_MY_SCREENSHOTS_RETRY_ID,
  GAME_MY_SCREENSHOTS_VIEW_ALL_ID,
  getGameMyScreenshotItemId,
} from "../navigation";
import { ScreenshotHotkeyHint } from "./hotkey-hint";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { MyScreenshotsPartialNotice } from "./partial-notice";
import { PublishedScreenshotThumbnail } from "./published-thumbnail";
import {
  GameScreenshotsModal,
  type GameScreenshotsTab,
} from "./screenshots-modal";
import {
  useLocalScreenshotActions,
  type LocalScreenshotActions,
} from "./use-local-screenshot-actions";
import {
  useFocusFollowsPublishedLocal,
  useMyGameScreenshots,
} from "./use-my-game-screenshots";
import { useMyScreenshotsViewer } from "./use-my-screenshots-viewer";

const SIDEBAR_SCREENSHOT_COUNT = 4;
const PUBLISHED_WAIT_TIMEOUT_MS = 1_500;
const SIDEBAR_COLUMNS = 2;
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const isFullWidthThumbnail = (index: number, count: number) =>
  count <= 2 || (count === 3 && index === 2);

const getThumbnailNavigation = (
  items: MyScreenshotItem[],
  index: number,
  leftTarget: FocusOverrideTarget
): FocusOverrides => {
  if (isFullWidthThumbnail(index, items.length)) {
    return { left: leftTarget, right: BLOCK_TARGET };
  }

  return index % SIDEBAR_COLUMNS === 0
    ? { left: leftTarget }
    : {
        left: getItemFocusTarget(
          getGameMyScreenshotItemId(items[index - 1].id)
        ),
        right: BLOCK_TARGET,
      };
};

interface MyScreenshotsGridProps {
  items: MyScreenshotItem[];
  local: LocalScreenshotActions;
  showCommentCount: boolean;
  leftTarget: FocusOverrideTarget;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onOpenLocal?: (screenshot: LocalScreenshot) => void;
  onRefreshImage: (screenshot: ProfileScreenshot) => Promise<void>;
}

const resolveFocusTargetNodeId = (target: FocusOverrideTarget) => {
  if (target.type === "item") return target.itemId;
  if (target.type === "block") return null;

  return (
    target.initialFocusId ??
    NavigationService.getInstance()
      .getNodes()
      .find((node) => node.regionId === target.regionId)?.id ??
    null
  );
};

const getLocalItemFocusId = (clientId: string) =>
  getGameMyScreenshotItemId(`local:${clientId}`);

const getFocusAfterDeleteId = (
  items: MyScreenshotItem[],
  index: number,
  leftTarget: FocusOverrideTarget
) => {
  const neighbour = items[index + 1] ?? items[index - 1];
  if (neighbour) return getGameMyScreenshotItemId(neighbour.id);

  return resolveFocusTargetNodeId(leftTarget);
};

const getFocusAfterViewerLocalDeleteId = (
  items: MyScreenshotItem[],
  screenshot: LocalScreenshot,
  leftTarget: FocusOverrideTarget
) => {
  const index = items.findIndex(
    (item) =>
      item.kind === "local" && item.screenshot.clientId === screenshot.clientId
  );
  if (index !== -1) return getFocusAfterDeleteId(items, index, leftTarget);

  const lastVisible = items.at(-1);
  if (lastVisible) return getGameMyScreenshotItemId(lastVisible.id);

  return resolveFocusTargetNodeId(leftTarget);
};

function MyScreenshotsGrid({
  items,
  local,
  showCommentCount,
  leftTarget,
  onOpen,
  onOpenLocal,
  onRefreshImage,
}: Readonly<MyScreenshotsGridProps>) {
  return (
    <GridFocusGroup
      regionId={GAME_MY_SCREENSHOTS_GRID_REGION_ID}
      className="game-my-screenshots__grid"
      navigationOrder={0}
    >
      {items.map((item, index) => {
        const focusId = getGameMyScreenshotItemId(item.id);
        const navigationOverrides = getThumbnailNavigation(
          items,
          index,
          leftTarget
        );

        return item.kind === "published" ? (
          <PublishedScreenshotThumbnail
            key={item.id}
            screenshot={item.screenshot}
            focusId={focusId}
            showCommentCount={showCommentCount}
            navigationOverrides={navigationOverrides}
            onOpen={onOpen}
            onRefreshImage={onRefreshImage}
          />
        ) : (
          <LocalScreenshotTile
            key={item.id}
            screenshot={item.screenshot}
            focusId={focusId}
            alt={local.describe(item.screenshot)}
            isBusy={local.busyIds.has(item.screenshot.clientId)}
            variant="thumbnail"
            navigationOverrides={navigationOverrides}
            onOpen={(screenshot) => onOpenLocal?.(screenshot)}
            onDelete={(screenshot) =>
              local.requestDelete(
                screenshot,
                getFocusAfterDeleteId(items, index, leftTarget)
              )
            }
          />
        );
      })}
    </GridFocusGroup>
  );
}

interface CommunityScreenshotsOptions {
  enabled: boolean;
  shop: GameShop;
  objectId: string;
  writeBus: ScreenshotWriteBus;
}

function useSidebarCommunityScreenshots({
  enabled,
  shop,
  objectId,
  writeBus,
}: CommunityScreenshotsOptions) {
  const { userDetails } = useUserDetails();
  const isSignedIn = Boolean(userDetails);
  const buildPath = useCallback(
    (cursor: string | null) =>
      buildGameScreenshotsPath({
        shop,
        objectId,
        cursor,
        sort: "top",
        take: SIDEBAR_SCREENSHOT_COUNT,
      }),
    [objectId, shop]
  );
  const feed = useScreenshotFeed({
    requestKey: enabled ? `${shop}:${objectId}:top:sidebar-community` : null,
    buildPath,
    needsAuth: isSignedIn,
    writeBus,
  });
  const { lightboxProps, open } = useScreenshotLightbox({
    items: feed.items,
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
  const items = useMemo<MyScreenshotItem[]>(
    () =>
      feed.items.slice(0, SIDEBAR_SCREENSHOT_COUNT).map((screenshot) => ({
        kind: "published",
        id: `community:${screenshot.id}`,
        screenshot,
      })),
    [feed.items]
  );

  return { feed, items, lightboxProps, open };
}

function useHasWaited(key: string, timeoutMs: number) {
  const [expiredKey, setExpiredKey] = useState<string | null>(null);

  useEffect(() => {
    const timeout = setTimeout(() => setExpiredKey(key), timeoutMs);
    return () => clearTimeout(timeout);
  }, [key, timeoutMs]);

  return expiredKey === key;
}

interface MyScreenshotsMessageProps {
  isLoading: boolean;
  hasLoadError: boolean;
  leftTarget: FocusOverrideTarget;
  onRetry: () => void;
}

function MyScreenshotsMessage({
  isLoading,
  hasLoadError,
  leftTarget,
  onRetry,
}: Readonly<MyScreenshotsMessageProps>) {
  const { t } = useTranslation("big_picture");

  if (hasLoadError) {
    return (
      <div className="game-my-screenshots__message">
        <p>{t("screenshots_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_MY_SCREENSHOTS_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
          focusNavigationOrder={1}
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="game-my-screenshots__message">
        <ImageIcon size={20} />
        <p>{t("screenshots_loading")}</p>
      </div>
    );
  }

  return (
    <div className="game-my-screenshots__message">
      <ImageIcon size={20} />
      <p>{t("screenshots_empty_filtered")}</p>
      <ScreenshotHotkeyHint className="game-my-screenshots__hint" />
    </div>
  );
}

export interface GameMyScreenshotsProps {
  shop: GameShop;
  objectId: string;
  communityShop: GameShop;
  communityObjectId: string;
  navigationOrder: number;
  leftTarget: FocusOverrideTarget;
}

export function GameMyScreenshots({
  shop,
  objectId,
  communityShop,
  communityObjectId,
  navigationOrder,
  leftTarget,
}: Readonly<GameMyScreenshotsProps>) {
  const { t } = useTranslation("big_picture");
  const { isFeatureEnabled } = useFeature();
  const [modalTab, setModalTab] = useState<GameScreenshotsTab | null>(null);
  const [writeBus] = useState(createScreenshotWriteBus);
  const isEnabled = isFeatureEnabled(Feature.Screenshots);
  const mine = useMyGameScreenshots({
    shop,
    objectId,
    sort: "recent",
    take: SIDEBAR_SCREENSHOT_COUNT,
    isEnabled,
    writeBus,
    feedKeySuffix: "sidebar",
  });
  const { feed } = mine;
  useFocusFollowsPublishedLocal(
    mine.pendingLocal,
    feed.items.map((item) => item.id),
    getLocalItemFocusId,
    getGameMyScreenshotItemId
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
  const items = mine.items.slice(0, SIDEBAR_SCREENSHOT_COUNT);
  const hasMoreUploaded = mine.canFetchPublished && feed.hasMore;
  const oldestLoadedUpload = feed.items.at(-1)?.capturedAt ?? null;
  const viewer = useMyScreenshotsViewer({
    entries: mine.items
      .filter(
        (item) =>
          item.kind !== "local" ||
          !hasMoreUploaded ||
          oldestLoadedUpload === null ||
          item.screenshot.capturedAt >= oldestLoadedUpload
      )
      .map(
        (item): ScreenshotViewerEntry =>
          item.kind === "local"
            ? { kind: "local", screenshot: item.screenshot }
            : { kind: "uploaded", screenshot: item.screenshot }
      ),
    localScreenshots: mine.localScreenshots,
    hasLocalLoaded: mine.hasLoadedLocal,
    uploadedItems: feed.items,
    canResolveUploaded: mine.canFetchPublished,
    openUploaded: open,
    closeUploaded: close,
    getFocusAfterLocalDeleteId: (screenshot) =>
      getFocusAfterViewerLocalDeleteId(items, screenshot, leftTarget),
  });
  const hasWaitedForPublished = useHasWaited(
    `${shop}:${objectId}`,
    PUBLISHED_WAIT_TIMEOUT_MS
  );
  const isSettled =
    mine.hasLoaded ||
    (hasWaitedForPublished && mine.hasLoadedLocal && !mine.hasLocalFailed);
  const hasCommunity = communityShop !== "custom";
  const hasNoScreenshotsOfMine =
    mine.hasLoaded && !mine.hasFailed && !mine.isPartial && items.length === 0;
  const community = useSidebarCommunityScreenshots({
    enabled: isEnabled && hasCommunity && hasNoScreenshotsOfMine,
    shop: communityShop,
    objectId: communityObjectId,
    writeBus,
  });
  const showCommunity = hasNoScreenshotsOfMine && community.items.length > 0;
  const title = t(
    hasCommunity && hasNoScreenshotsOfMine
      ? "community_screenshots_tab"
      : "my_screenshots",
    { ns: "screenshots" }
  );
  const showGrid = isSettled && items.length > 0 && !mine.hasFailed;
  const showMessage = !showGrid && !showCommunity && !mine.isPartial;
  const isMessageLoading = !isSettled || community.feed.isLoading;
  const getViewAllTab = (): GameScreenshotsTab | null => {
    if (showCommunity) return "community";
    if (showGrid) return "mine";
    if (hasCommunity && mine.hasLoaded && !hasNoScreenshotsOfMine) {
      return "mine";
    }
    return null;
  };
  const viewAllTab = getViewAllTab();
  const closeModal = () => {
    setModalTab(null);
    if (viewAllTab) return;

    const focusId = resolveFocusTargetNodeId(leftTarget);
    if (focusId) {
      NavigationService.getInstance().requestFocusWhenAvailable(focusId);
    }
  };

  if (!isEnabled) return null;

  return (
    <VerticalFocusGroup
      regionId={GAME_MY_SCREENSHOTS_REGION_ID}
      navigationOrder={navigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-my-screenshots"
        aria-label={title}
      >
        <div className="game-my-screenshots__title">
          <Typography>{title}</Typography>
        </div>
        <div className="game-my-screenshots__body">
          {showGrid ? (
            <MyScreenshotsGrid
              items={items}
              local={local}
              showCommentCount={isFeatureEnabled(Feature.ScreenshotComments)}
              leftTarget={leftTarget}
              onOpen={(screenshot) =>
                viewer.openEntry({ kind: "uploaded", screenshot })
              }
              onOpenLocal={(screenshot) =>
                viewer.openEntry({ kind: "local", screenshot })
              }
              onRefreshImage={feed.refreshImage}
            />
          ) : null}
          {showCommunity ? (
            <MyScreenshotsGrid
              items={community.items}
              local={local}
              showCommentCount={isFeatureEnabled(Feature.ScreenshotComments)}
              leftTarget={leftTarget}
              onOpen={community.open}
              onRefreshImage={community.feed.refreshImage}
            />
          ) : null}
          {showMessage ? (
            <MyScreenshotsMessage
              isLoading={isMessageLoading}
              hasLoadError={mine.hasFailed}
              leftTarget={leftTarget}
              onRetry={mine.retry}
            />
          ) : null}
          <MyScreenshotsPartialNotice
            mine={mine}
            focusId={GAME_MY_SCREENSHOTS_RETRY_ID}
            className="game-my-screenshots__notice"
            navigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
            navigationOrder={1}
          />
          {viewAllTab ? (
            <Button
              variant="secondary"
              size="small"
              focusId={GAME_MY_SCREENSHOTS_VIEW_ALL_ID}
              className="game-my-screenshots__view-all"
              icon={<SquaresFourIcon size={18} />}
              focusNavigationOverrides={{
                left: leftTarget,
                right: BLOCK_TARGET,
              }}
              focusNavigationOrder={2}
              onClick={() => setModalTab(viewAllTab)}
            >
              {t("screenshots_view_all")}
            </Button>
          ) : null}
        </div>

        <ScreenshotLightbox {...lightboxProps} localSlot={viewer.localSlot} />
        <ScreenshotLightbox {...community.lightboxProps} />
        {local.elements}
        <GameScreenshotsModal
          visible={modalTab !== null}
          shop={shop}
          objectId={objectId}
          communityShop={communityShop}
          communityObjectId={communityObjectId}
          writeBus={writeBus}
          initialTab={modalTab ?? "mine"}
          onClose={closeModal}
        />
      </section>
    </VerticalFocusGroup>
  );
}
