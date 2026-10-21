import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlameIcon, HistoryIcon, ImageIcon } from "@primer/octicons-react";
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

import { useGameScreenshotsCollection } from "./use-game-screenshots-collection";

const MODAL_PAGE_SIZE = 24;
const SKELETON_COUNT = 6;
const INFINITE_SCROLL_THRESHOLD = 0.9;

const SORT_OPTIONS: { value: ScreenshotSort; icon: typeof HistoryIcon }[] = [
  { value: "recent", icon: HistoryIcon },
  { value: "top", icon: FlameIcon },
];

interface GameScreenshotsModalProps {
  visible: boolean;
  showCommentCount: boolean;
  shop: GameShop;
  objectId: string;
  writeBus: ScreenshotWriteBus;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  showCommentCount,
  shop,
  objectId,
  writeBus,
  onClose,
}: Readonly<GameScreenshotsModalProps>) {
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

  useEffect(() => {
    const paging = trackSpoilerPaging(
      spoilerPagingRef.current,
      loadedCount,
      visibleCount
    );
    spoilerPagingRef.current = paging;
    const input = { hideSpoilers, canLoadMore, paging };
    setIsSpoilerPagingOnHold(isSpoilerPagingPaused(input));

    if (shouldAutoLoadSpoilerPage(input)) void feed.loadMore();
  }, [canLoadMore, feed, hideSpoilers, loadedCount, visibleCount]);

  const loadMoreByRequest = () => {
    spoilerPagingRef.current = resumeSpoilerPaging(spoilerPagingRef.current);
    setIsSpoilerPagingOnHold(false);
    void feed.loadMore();
  };

  const handleSortChange = (nextSort: ScreenshotSort) => {
    if (nextSort === sort) return;
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
          <output className="game-screenshots-modal__loading">
            {t("loading_screenshots")}
          </output>
        }
        scrollThreshold={INFINITE_SCROLL_THRESHOLD}
        scrollableTarget={scrollId}
        style={{ overflow: "visible" }}
      >
        <ul className="screenshot-grid">
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
      <Modal
        visible={visible}
        title={t("community_screenshots")}
        onClose={onClose}
        large
        className="game-screenshots-modal"
      >
        <div className="game-screenshots-modal__toolbar">
          <fieldset
            className="game-screenshots-modal__sort"
            aria-label={t("sort_by")}
          >
            {SORT_OPTIONS.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                className={cn("game-screenshots-modal__sort-option", {
                  "game-screenshots-modal__sort-option--active": sort === value,
                })}
                aria-pressed={sort === value}
                onClick={() => handleSortChange(value)}
              >
                <Icon size={14} />
                {t(`sort_${value}`)}
              </button>
            ))}
          </fieldset>

          <CheckboxField
            label={t("hide_spoilers")}
            checked={hideSpoilers}
            onChange={(event) => setHideSpoilers(event.target.checked)}
          />
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
      </Modal>

      <ScreenshotLightbox
        collection={collection}
        navigationItems={visibleItems}
      />
    </>
  );
}
