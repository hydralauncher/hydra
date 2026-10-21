import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlameIcon, HistoryIcon, ImageIcon } from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import Skeleton from "react-loading-skeleton";
import cn from "classnames";

import { CheckboxField, Modal } from "@renderer/components";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  ScreenshotLoadMoreError,
  readStoredScreenshotSort,
  storeScreenshotPreference,
} from "@renderer/components/screenshots";
import { GAME_SCREENSHOT_SORT_STORAGE_KEY } from "@renderer/session-state-keys";
import type { GameShop, ScreenshotSort } from "@types";

import { useGameScreenshotsCollection } from "./use-game-screenshots-collection";

const MODAL_PAGE_SIZE = 24;
const SKELETON_COUNT = 6;
const MIN_VISIBLE_WHEN_FILTERED = 12;
const INFINITE_SCROLL_THRESHOLD = 0.9;

const SORT_OPTIONS: { value: ScreenshotSort; icon: typeof HistoryIcon }[] = [
  { value: "recent", icon: HistoryIcon },
  { value: "top", icon: FlameIcon },
];

interface GameScreenshotsModalProps {
  visible: boolean;
  shop: GameShop;
  objectId: string;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  shop,
  objectId,
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

  useEffect(() => {
    if (
      hideSpoilers &&
      canLoadMore &&
      visibleItems.length < MIN_VISIBLE_WHEN_FILTERED
    ) {
      void feed.loadMore();
    }
  }, [canLoadMore, feed, hideSpoilers, visibleItems.length]);

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

    if (visibleItems.length === 0 && !feed.hasMore) {
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
        dataLength={visibleItems.length}
        next={() => void feed.loadMore()}
        hasMore={feed.hasMore && !feed.hasLoadMoreFailed}
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
              onOpen={lightbox.open}
              onLike={(item) => void actions.toggleLike(item)}
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

          {feed.hasLoadMoreFailed ? (
            <ScreenshotLoadMoreError onRetry={() => void feed.loadMore()} />
          ) : null}
        </div>
      </Modal>

      <ScreenshotLightbox collection={collection} />
    </>
  );
}
