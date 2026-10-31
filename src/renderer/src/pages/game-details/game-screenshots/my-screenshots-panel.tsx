import { useId, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import InfiniteScroll from "react-infinite-scroll-component";
import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import {
  ScreenshotCard,
  ScreenshotLoadMoreError,
  useLoadUntilScrollable,
} from "@renderer/components/screenshots";
import {
  groupByCaptureDay,
  resolveMyGameScreenshotsStatus,
  selectPendingLocalWithinLoadedUploads,
  type ScreenshotWriteBus,
} from "@shared";
import type { GameShop } from "@types";

import { GameScreenshotsHotkeyTip } from "./game-screenshots-hotkey-tip";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import type { MyScreenshotsEntry } from "./my-screenshots-entries";
import { MyScreenshotsLightbox } from "./my-screenshots-lightbox";
import { MyScreenshotsPartialNotice } from "./my-screenshots-partial-notice";
import { useMyScreenshotsViewer } from "./use-my-screenshots-viewer";
import { useCaptureDayLabel } from "./screenshot-date-groups";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import {
  useCanFetchMyPublishedScreenshots,
  useMyLocalGameScreenshots,
  useMyPublishedGameScreenshots,
  useVisibleLocalScreenshots,
} from "./use-my-game-screenshots";

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

  const localState = useMyLocalGameScreenshots({
    shop,
    objectId,
    isEnabled: visible,
  });
  const published = useMyPublishedGameScreenshots({
    shop,
    objectId,
    take: MY_SCREENSHOTS_PAGE_SIZE,
    writeBus,
    settledCount: localState.settledCount,
    sort: "recent",
    isEnabled: visible && canFetchPublished,
  });
  const { feed, actions, lightbox } = published;
  const visibleLocal = useVisibleLocalScreenshots(
    localState,
    feed,
    canFetchPublished
  );
  const local = useLocalScreenshotActions();
  const getDayLabel = useCaptureDayLabel();

  const uploadedItems = canFetchPublished ? feed.items : [];
  const hasMoreUploaded = canFetchPublished && feed.hasMore;
  const entries: MyScreenshotsEntry[] = [
    ...selectPendingLocalWithinLoadedUploads(
      visibleLocal,
      uploadedItems,
      hasMoreUploaded
    ).map((screenshot) => ({
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

  const viewer = useMyScreenshotsViewer({
    lightbox,
    feed,
    localScreenshots: localState.localScreenshots,
    hasLocalLoaded: localState.hasLoaded,
    uploadedItems,
    getUploadStatus: local.getUploadStatus,
  });

  const status = resolveMyGameScreenshotsStatus({
    local: { isLoaded: localState.hasLoaded, hasFailed: localState.hasFailed },
    published: {
      isEnabled: canFetchPublished,
      isLoaded: feed.hasLoaded,
      hasFailed: feed.hasFailed,
    },
  });

  useLoadUntilScrollable({
    scrollTargetId: scrollId,
    canLoadMore:
      visible &&
      canFetchPublished &&
      feed.hasLoaded &&
      feed.hasMore &&
      !feed.isLoading &&
      !feed.hasLoadMoreFailed,
    itemCount: entries.length,
    loadMore: feed.loadMore,
  });

  const retry = () => {
    if (localState.hasFailed) localState.retry();
    if (canFetchPublished && feed.hasFailed) void feed.reload();
  };

  const renderEntry = (entry: MyScreenshotsEntry) => {
    if (entry.kind === "uploaded") {
      return (
        <ScreenshotCard
          key={entry.screenshot.id}
          screenshot={entry.screenshot}
          variant="tile"
          isOwner
          isLiking={actions.likingIds.has(entry.screenshot.id)}
          showCommentCount={showCommentCount}
          onOpen={(item) =>
            viewer.openEntry({
              kind: "uploaded",
              time: item.capturedAt,
              screenshot: item,
            })
          }
          onLike={(item) => void actions.toggleLike(item)}
          onImageError={lightbox.refreshScreenshot}
        />
      );
    }

    const { screenshot } = entry;
    return (
      <li key={screenshot.clientId} className="screenshot-card">
        <LocalScreenshotTile
          screenshot={screenshot}
          alt={local.describe(screenshot)}
          isBusy={local.busyIds.has(screenshot.clientId)}
          uploadStatus={local.getUploadStatus(screenshot)}
          className="local-screenshot-tile--card"
          onOpen={(item) =>
            viewer.openEntry({
              kind: "local",
              time: item.capturedAt,
              screenshot: item,
            })
          }
          onDelete={local.requestDelete}
        />
      </li>
    );
  };

  const renderDayGroups = () =>
    groupByCaptureDay(entries, (entry) => entry.time).map((group) => (
      <section key={group.key} className="game-screenshots-modal__day">
        <h4 className="game-screenshots-modal__day-title">
          {getDayLabel(group.dayStart)}
        </h4>
        <ul className="screenshot-grid">{group.items.map(renderEntry)}</ul>
      </section>
    ));

  const renderContent = (): ReactNode => {
    if (status === "failed") return <LoadError onRetry={retry} />;
    if (status === "loading") return <GridSkeleton />;

    const partialNotice =
      status === "partial" ? (
        <MyScreenshotsPartialNotice
          hasLocalFailed={localState.hasFailed}
          onRetry={retry}
        />
      ) : null;

    if (entries.length === 0) return partialNotice ?? <EmptyState />;

    return (
      <InfiniteScroll
        dataLength={entries.length}
        next={() => void feed.loadMore()}
        hasMore={hasMoreUploaded && !feed.hasLoadMoreFailed}
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
        {partialNotice}
        {renderDayGroups()}
      </InfiniteScroll>
    );
  };

  return (
    <div className="game-screenshots-modal__panel">
      <div id={scrollId} className="game-screenshots-modal__scroll">
        {renderContent()}

        {canFetchPublished && feed.hasLoadMoreFailed ? (
          <ScreenshotLoadMoreError onRetry={() => void feed.loadMore()} />
        ) : null}
      </div>

      <MyScreenshotsLightbox
        collection={published}
        entries={entries}
        openLocal={viewer.openLocal}
        describeLocal={local.describe}
        onOpenEntry={viewer.openEntry}
        onClose={viewer.close}
      />
      {local.elements}
    </div>
  );
}
