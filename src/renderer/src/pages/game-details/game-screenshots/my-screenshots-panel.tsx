import { useEffect, useId, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  ScreenshotLoadMoreError,
  useLoadUntilScrollable,
} from "@renderer/components/screenshots";
import type { ScreenshotWriteBus } from "@shared";
import type { GameShop, ProfileScreenshot, ScreenshotSort } from "@types";

import { GameScreenshotsHotkeyTip } from "./game-screenshots-hotkey-tip";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import {
  ScreenshotSortToggle,
  SegmentedToggle,
} from "./screenshot-sort-toggle";
import {
  groupByCaptureDay,
  useCaptureDayLabel,
} from "./screenshot-date-groups";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import {
  useCanFetchMyPublishedScreenshots,
  useMyLocalGameScreenshots,
  useMyPublishedGameScreenshots,
} from "./use-my-game-screenshots";

const MY_SCREENSHOTS_PAGE_SIZE = 24;
const SKELETON_COUNT = 6;
const INFINITE_SCROLL_THRESHOLD = 0.9;

type MyScreenshotsStatusFilter = "uploaded" | "local";

interface MyScreenshotsPanelProps {
  visible: boolean;
  showCommentCount: boolean;
  shop: GameShop;
  objectId: string;
  writeBus: ScreenshotWriteBus;
}

function GridSkeleton() {
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

function LoadError({ onRetry }: Readonly<{ onRetry: () => void }>) {
  const { t } = useTranslation("screenshots");
  return (
    <output className="game-screenshots-modal__empty">
      <span>{t("screenshots_load_failed")}</span>
      <Button theme="outline" onClick={onRetry}>
        {t("retry")}
      </Button>
    </output>
  );
}

function EmptyState() {
  const { t } = useTranslation("screenshots");
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

export function MyScreenshotsPanel({
  visible,
  showCommentCount,
  shop,
  objectId,
  writeBus,
}: Readonly<MyScreenshotsPanelProps>) {
  const { t } = useTranslation("screenshots");
  const scrollId = useId();
  const { canFetchPublished } = useCanFetchMyPublishedScreenshots(shop);
  const [statusFilter, setStatusFilter] =
    useState<MyScreenshotsStatusFilter>("local");
  const [sort, setSort] = useState<ScreenshotSort>("recent");
  const [visitedSorts, setVisitedSorts] = useState<ReadonlySet<ScreenshotSort>>(
    () => new Set<ScreenshotSort>(["recent"])
  );
  useEffect(() => {
    if (visible) setStatusFilter("local");
  }, [visible]);

  const activeFilter: MyScreenshotsStatusFilter = canFetchPublished
    ? statusFilter
    : "local";

  const localState = useMyLocalGameScreenshots({
    shop,
    objectId,
    isEnabled: visible,
  });
  const publishedOptions = {
    shop,
    objectId,
    take: MY_SCREENSHOTS_PAGE_SIZE,
    writeBus,
    settledCount: localState.settledCount,
  };
  const recent = useMyPublishedGameScreenshots({
    ...publishedOptions,
    sort: "recent",
    isEnabled: visible && visitedSorts.has("recent"),
  });
  const top = useMyPublishedGameScreenshots({
    ...publishedOptions,
    sort: "top",
    isEnabled: visible && visitedSorts.has("top"),
  });
  const published = sort === "top" ? top : recent;
  const { feed, actions, lightbox } = published;
  const local = useLocalScreenshotActions();
  const getDayLabel = useCaptureDayLabel();

  const renderDayGroups = <Item,>(
    items: Item[],
    getCapturedAt: (item: Item) => number,
    renderItem: (item: Item) => ReactNode
  ) =>
    groupByCaptureDay(items, getCapturedAt).map((group) => (
      <section key={group.key} className="game-screenshots-modal__day">
        <h4 className="game-screenshots-modal__day-title">
          {getDayLabel(group.dayStart)}
        </h4>
        <ul className="screenshot-grid">{group.items.map(renderItem)}</ul>
      </section>
    ));

  useLoadUntilScrollable({
    scrollTargetId: scrollId,
    canLoadMore:
      visible &&
      activeFilter === "uploaded" &&
      feed.hasLoaded &&
      feed.hasMore &&
      !feed.isLoading &&
      !feed.hasLoadMoreFailed,
    itemCount: feed.items.length,
    loadMore: feed.loadMore,
  });

  const changeSort = (nextSort: ScreenshotSort) => {
    setVisitedSorts((current) => new Set(current).add(nextSort));
    setSort(nextSort);
  };

  const renderUploadedCard = (screenshot: ProfileScreenshot) => (
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
  );

  const renderUploaded = (): ReactNode => {
    if (feed.hasFailed) return <LoadError onRetry={() => void feed.reload()} />;
    if (!feed.hasLoaded) return <GridSkeleton />;
    if (feed.items.length === 0) return <EmptyState />;

    return (
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
        {sort === "recent" ? (
          renderDayGroups(
            feed.items,
            (screenshot) => screenshot.capturedAt,
            renderUploadedCard
          )
        ) : (
          <ul className="screenshot-grid">
            {feed.items.map(renderUploadedCard)}
          </ul>
        )}
      </InfiniteScroll>
    );
  };

  const renderLocal = (): ReactNode => {
    if (localState.hasFailed) return <LoadError onRetry={localState.retry} />;
    if (!localState.hasLoaded) return <GridSkeleton />;
    if (localState.pendingLocal.length === 0) return <EmptyState />;

    return renderDayGroups(
      localState.pendingLocal,
      (screenshot) => screenshot.capturedAt,
      (screenshot) => (
        <li key={screenshot.clientId} className="screenshot-card">
          <LocalScreenshotTile
            screenshot={screenshot}
            alt={local.describe(screenshot)}
            isBusy={local.busyIds.has(screenshot.clientId)}
            uploadStatus={local.getUploadStatus(screenshot)}
            className="local-screenshot-tile--card"
            onOpen={local.open}
            onDelete={local.requestDelete}
          />
        </li>
      )
    );
  };

  return (
    <div className="game-screenshots-modal__panel">
      <div className="game-screenshots-modal__toolbar">
        {canFetchPublished ? (
          <SegmentedToggle
            label={t("screenshot_status_filter")}
            value={activeFilter}
            options={[
              { value: "local", label: t("not_uploaded") },
              { value: "uploaded", label: t("uploaded") },
            ]}
            onChange={setStatusFilter}
          />
        ) : null}
        {activeFilter === "uploaded" ? (
          <ScreenshotSortToggle sort={sort} onChange={changeSort} />
        ) : null}
      </div>

      <div id={scrollId} className="game-screenshots-modal__scroll">
        {activeFilter === "uploaded" ? renderUploaded() : renderLocal()}

        {activeFilter === "uploaded" && feed.hasLoadMoreFailed ? (
          <ScreenshotLoadMoreError onRetry={() => void feed.loadMore()} />
        ) : null}
      </div>

      <ScreenshotLightbox
        collection={recent}
        navigationItems={recent.feed.items}
      />
      <ScreenshotLightbox collection={top} navigationItems={top.feed.items} />
      {local.elements}
    </div>
  );
}
