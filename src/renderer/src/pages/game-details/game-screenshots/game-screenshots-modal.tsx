import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import Skeleton from "react-loading-skeleton";
import cn from "classnames";

import { Button, CheckboxField, Modal } from "@renderer/components";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  ScreenshotLoadMoreError,
  readStoredScreenshotSort,
  storeScreenshotPreference,
  useLoadUntilScrollable,
} from "@renderer/components/screenshots";
import { GAME_SCREENSHOT_SORT_STORAGE_KEY } from "@renderer/session-state-keys";
import {
  INITIAL_SCREENSHOT_SPOILER_PAGING,
  isSpoilerPagingPaused,
  resumeSpoilerPaging,
  shouldAutoLoadSpoilerPage,
  trackSpoilerPaging,
  type ScreenshotWriteBus,
} from "@shared";
import type { GameShop, ScreenshotSort } from "@types";

import { MyScreenshotsPanel } from "./my-screenshots-panel";
import { ScreenshotSortToggle } from "./screenshot-sort-toggle";
import { useGameScreenshotsCollection } from "./use-game-screenshots-collection";

const MODAL_PAGE_SIZE = 24;
const SKELETON_COUNT = 6;
const INFINITE_SCROLL_THRESHOLD = 0.9;

interface ScreenshotsPanelProps {
  visible: boolean;
  showCommentCount: boolean;
  shop: GameShop;
  objectId: string;
  writeBus: ScreenshotWriteBus;
}

function CommunityScreenshotsPanel({
  visible,
  showCommentCount,
  shop,
  objectId,
  writeBus,
}: Readonly<ScreenshotsPanelProps>) {
  const { t } = useTranslation("screenshots");
  const scrollId = useId();
  const [sort, setSort] = useState<ScreenshotSort>(() =>
    readStoredScreenshotSort(GAME_SCREENSHOT_SORT_STORAGE_KEY)
  );
  const [hideSpoilers, setHideSpoilers] = useState(false);
  const collection = useGameScreenshotsCollection({
    shop,
    objectId,
    sort,
    take: MODAL_PAGE_SIZE,
    isEnabled: visible,
    writeBus,
  });
  const { feed, actions, lightbox } = collection;
  const visibleItems = useMemo(
    () =>
      hideSpoilers
        ? feed.items.filter((screenshot) => !screenshot.isSpoiler)
        : feed.items,
    [feed.items, hideSpoilers]
  );
  const canLoadMore =
    feed.hasMore && !feed.isLoading && !feed.hasLoadMoreFailed;
  const isInitialLoading =
    !feed.hasLoaded || (feed.isLoading && feed.items.length === 0);

  const spoilerPagingRef = useRef(INITIAL_SCREENSHOT_SPOILER_PAGING);
  const [isSpoilerPagingOnHold, setIsSpoilerPagingOnHold] = useState(false);
  const loadedCount = feed.items.length;
  const visibleCount = visibleItems.length;
  const loadMoreFeed = feed.loadMore;

  useEffect(() => {
    const paging = trackSpoilerPaging(
      spoilerPagingRef.current,
      loadedCount,
      visibleCount
    );
    spoilerPagingRef.current = paging;
    const input = { hideSpoilers, canLoadMore, paging };
    setIsSpoilerPagingOnHold(isSpoilerPagingPaused(input));

    if (shouldAutoLoadSpoilerPage(input)) void loadMoreFeed();
  }, [canLoadMore, hideSpoilers, loadMoreFeed, loadedCount, visibleCount]);

  useLoadUntilScrollable({
    scrollTargetId: scrollId,
    canLoadMore:
      visible && feed.hasLoaded && canLoadMore && !isSpoilerPagingOnHold,
    itemCount: feed.items.length,
    loadMore: feed.loadMore,
  });

  const loadMoreByRequest = () => {
    spoilerPagingRef.current = resumeSpoilerPaging(spoilerPagingRef.current);
    setIsSpoilerPagingOnHold(false);
    void feed.loadMore();
  };

  const handleSortChange = (nextSort: ScreenshotSort) => {
    setSort(nextSort);
    storeScreenshotPreference(GAME_SCREENSHOT_SORT_STORAGE_KEY, nextSort);
  };

  const renderGrid = () => {
    if (isInitialLoading) {
      return (
        <ul className="screenshot-grid" aria-busy="true">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <li key={`game-screenshots-modal-skeleton-${index}`}>
              <Skeleton className="game-screenshots-modal__skeleton" />
            </li>
          ))}
        </ul>
      );
    }

    if (feed.hasFailed) {
      return <ScreenshotLoadMoreError onRetry={() => void feed.reload()} />;
    }

    if (visibleItems.length === 0 && (!feed.hasMore || isSpoilerPagingOnHold)) {
      return (
        <output className="game-screenshots-modal__empty">
          <span className="game-screenshots-modal__empty-icon">
            <ImageIcon size={24} />
          </span>
          <span>
            {feed.items.length === 0
              ? t("no_game_screenshots")
              : t("all_screenshots_are_spoilers")}
          </span>
        </output>
      );
    }

    return (
      <InfiniteScroll
        dataLength={feed.items.length}
        next={loadMoreByRequest}
        hasMore={
          feed.hasMore && !feed.hasLoadMoreFailed && !isSpoilerPagingOnHold
        }
        loader={
          feed.isLoading ? (
            <output className="game-screenshots-modal__loading">
              {t("loading_screenshots")}
            </output>
          ) : null
        }
        scrollThreshold={INFINITE_SCROLL_THRESHOLD}
        scrollableTarget={scrollId}
        style={{ overflow: "visible" }}
      >
        <ul className="screenshot-grid screenshot-grid--large">
          {visibleItems.map((screenshot) => (
            <ScreenshotCard
              key={screenshot.id}
              screenshot={screenshot}
              variant="game"
              isOwner={false}
              isLiking={actions.likingIds.has(screenshot.id)}
              showCommentCount={showCommentCount}
              onOpen={lightbox.open}
              onLike={(item) => void actions.toggleLike(item)}
              onImageError={lightbox.refreshScreenshot}
            />
          ))}
        </ul>
      </InfiniteScroll>
    );
  };

  return (
    <>
      <div className="game-screenshots-modal__panel">
        <div className="game-screenshots-modal__toolbar">
          <CheckboxField
            label={t("hide_spoilers")}
            checked={hideSpoilers}
            onChange={(event) => setHideSpoilers(event.target.checked)}
          />

          <ScreenshotSortToggle sort={sort} onChange={handleSortChange} />
        </div>

        <div id={scrollId} className="game-screenshots-modal__scroll">
          {renderGrid()}

          {isSpoilerPagingOnHold ? (
            <Button
              theme="outline"
              className="game-screenshots-modal__load-more"
              onClick={loadMoreByRequest}
            >
              {t("load_more_screenshots")}
            </Button>
          ) : null}

          {feed.hasLoadMoreFailed ? (
            <ScreenshotLoadMoreError onRetry={() => void feed.loadMore()} />
          ) : null}
        </div>
      </div>

      <ScreenshotLightbox
        collection={collection}
        navigationItems={visibleItems}
      />
    </>
  );
}

export type GameScreenshotsTab = "mine" | "community";

export interface ScreenshotsGame {
  shop: GameShop;
  objectId: string;
}

interface GameScreenshotsModalProps {
  visible: boolean;
  showCommentCount: boolean;
  libraryGame: ScreenshotsGame;
  catalogueGame: ScreenshotsGame;
  writeBus: ScreenshotWriteBus;
  initialTab?: GameScreenshotsTab;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  showCommentCount,
  libraryGame,
  catalogueGame,
  writeBus,
  initialTab = "mine",
  onClose,
}: Readonly<GameScreenshotsModalProps>) {
  const { t } = useTranslation("screenshots");
  const [tab, setTab] = useState<GameScreenshotsTab>(initialTab);
  const tabs: { id: GameScreenshotsTab; label: string }[] = [
    { id: "mine", label: t("my_screenshots") },
    { id: "community", label: t("community_screenshots_tab") },
  ];

  useEffect(() => {
    if (visible) setTab(initialTab);
  }, [initialTab, visible]);

  return (
    <Modal
      visible={visible}
      headerContent={
        <div className="game-screenshots-modal__tabs" role="tablist">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={cn("game-screenshots-modal__tab", {
                "game-screenshots-modal__tab--active": tab === id,
              })}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>
      }
      onClose={onClose}
      large
      className="game-screenshots-modal"
    >
      {tab === "mine" ? (
        <MyScreenshotsPanel
          visible={visible}
          showCommentCount={showCommentCount}
          shop={libraryGame.shop}
          objectId={libraryGame.objectId}
          writeBus={writeBus}
        />
      ) : (
        <CommunityScreenshotsPanel
          visible={visible}
          showCommentCount={showCommentCount}
          shop={catalogueGame.shop}
          objectId={catalogueGame.objectId}
          writeBus={writeBus}
        />
      )}
    </Modal>
  );
}
