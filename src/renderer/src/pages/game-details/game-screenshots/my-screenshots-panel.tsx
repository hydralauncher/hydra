import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";

import { Button } from "@renderer/components";
import InfiniteScroll from "react-infinite-scroll-component";
import Skeleton from "react-loading-skeleton";

import {
  ScreenshotCard,
  ScreenshotLightbox,
  ScreenshotLoadMoreError,
  useLoadUntilScrollable,
} from "@renderer/components/screenshots";
import type { ScreenshotWriteBus } from "@shared";
import type { GameShop, ScreenshotSort } from "@types";

import { GameScreenshotsHotkeyTip } from "./game-screenshots-hotkey-tip";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { MyScreenshotsPartialNotice } from "./my-screenshots-partial-notice";
import { ScreenshotSortToggle } from "./screenshot-sort-toggle";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import { useMyGameScreenshots } from "./use-my-game-screenshots";

const MY_SCREENSHOTS_PAGE_SIZE = 24;
const SKELETON_COUNT = 6;
const INFINITE_SCROLL_THRESHOLD = 0.9;

interface MyScreenshotsPanelProps {
  visible: boolean;
  showCommentCount: boolean;
  shop: GameShop;
  objectId: string;
  writeBus: ScreenshotWriteBus;
}

export function MyScreenshotsPanel({
  visible,
  showCommentCount,
  shop,
  objectId,
  writeBus,
}: Readonly<MyScreenshotsPanelProps>) {
  const { t } = useTranslation("screenshots");
  const scrollId = useId();
  const [sort, setSort] = useState<ScreenshotSort>("recent");
  const mine = useMyGameScreenshots({
    shop,
    objectId,
    sort,
    take: MY_SCREENSHOTS_PAGE_SIZE,
    isEnabled: visible,
    writeBus,
  });
  const { feed, actions, lightbox } = mine.collection;
  const local = useLocalScreenshotActions(mine.pendingLocal);

  useLoadUntilScrollable({
    scrollTargetId: scrollId,
    canLoadMore:
      visible &&
      feed.hasLoaded &&
      feed.hasMore &&
      !feed.isLoading &&
      !feed.hasLoadMoreFailed,
    itemCount: feed.items.length,
    loadMore: feed.loadMore,
  });

  const renderGrid = () => {
    if (!mine.hasLoaded) {
      return (
        <ul className="screenshot-grid" aria-busy="true">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <li key={`my-screenshots-skeleton-${index}`}>
              <Skeleton className="game-screenshots-modal__skeleton" />
            </li>
          ))}
        </ul>
      );
    }

    if (mine.hasFailed) {
      return (
        <output className="game-screenshots-modal__empty">
          <span>{t("screenshots_load_failed")}</span>
          <Button theme="outline" onClick={mine.retry}>
            {t("retry")}
          </Button>
        </output>
      );
    }

    const hasLocal = mine.pendingLocal.length > 0;
    const hasPublished = feed.items.length > 0;

    if (!hasLocal && !hasPublished) {
      if (mine.isPartial) return null;
      return (
        <output className="game-screenshots-modal__empty">
          <span className="game-screenshots-modal__empty-icon">
            <ImageIcon size={24} />
          </span>
          <span>{t("no_game_screenshots_yet")}</span>
          <GameScreenshotsHotkeyTip />
        </output>
      );
    }

    return (
      <>
        {hasLocal ? (
          <section className="my-screenshots-section">
            <header className="my-screenshots-section__header">
              <h3>{t("not_uploaded")}</h3>
            </header>
            <ul className="screenshot-grid">
              {mine.pendingLocal.map((screenshot) => (
                <li key={screenshot.clientId} className="screenshot-card">
                  <LocalScreenshotTile
                    screenshot={screenshot}
                    alt={local.describe(screenshot)}
                    isBusy={local.busyIds.has(screenshot.clientId)}
                    className="local-screenshot-tile--card"
                    onOpen={local.open}
                    onUpload={local.upload}
                    onDelete={local.requestDelete}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {hasPublished ? (
          <section className="my-screenshots-section">
            <header className="my-screenshots-section__header">
              <h3>{t("published_screenshots_section")}</h3>
              <ScreenshotSortToggle sort={sort} onChange={setSort} />
            </header>
            <InfiniteScroll
              dataLength={feed.items.length}
              next={() => void feed.loadMore()}
              hasMore={feed.hasMore && !feed.hasLoadMoreFailed}
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
              <ul className="screenshot-grid">
                {feed.items.map((screenshot) => (
                  <ScreenshotCard
                    key={screenshot.id}
                    screenshot={screenshot}
                    variant="profile"
                    isOwner
                    isLiking={actions.likingIds.has(screenshot.id)}
                    showCommentCount={showCommentCount}
                    onOpen={lightbox.open}
                    onLike={(item) => void actions.toggleLike(item)}
                    onImageError={lightbox.refreshScreenshot}
                  />
                ))}
              </ul>
            </InfiniteScroll>
          </section>
        ) : null}
      </>
    );
  };

  return (
    <div className="game-screenshots-modal__panel">
      <div id={scrollId} className="game-screenshots-modal__scroll">
        {mine.isPartial ? (
          <MyScreenshotsPartialNotice
            hasLocalFailed={mine.hasLocalFailed}
            onRetry={mine.retryFailed}
          />
        ) : null}
        {renderGrid()}

        {feed.hasLoadMoreFailed ? (
          <ScreenshotLoadMoreError onRetry={() => void feed.loadMore()} />
        ) : null}
      </div>

      <ScreenshotLightbox
        collection={mine.collection}
        navigationItems={feed.items}
      />
      {local.elements}
    </div>
  );
}
