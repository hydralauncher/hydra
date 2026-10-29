import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { ScreenshotLightbox } from "@renderer/components/screenshots";
import { useFeature } from "@renderer/hooks";
import { createScreenshotWriteBus } from "@shared";

import { SidebarSection } from "../sidebar-section/sidebar-section";
import { GameScreenshotThumbnail } from "./game-screenshot-thumbnail";
import { GameScreenshotsHotkeyTip } from "./game-screenshots-hotkey-tip";
import {
  GameScreenshotsModal,
  type GameScreenshotsTab,
  type ScreenshotsGame,
} from "./game-screenshots-modal";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import type { MyScreenshotsEntry } from "./my-screenshots-entries";
import { MyScreenshotsLightbox } from "./my-screenshots-lightbox";
import { MyScreenshotsPartialNotice } from "./my-screenshots-partial-notice";
import { useGameScreenshotsCollection } from "./use-game-screenshots-collection";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import { useMyGameScreenshots } from "./use-my-game-screenshots";
import { useMyScreenshotsViewer } from "./use-my-screenshots-viewer";

import "./game-screenshots.scss";

const SIDEBAR_SCREENSHOT_COUNT = 4;

interface GameScreenshotsProps {
  libraryGame: ScreenshotsGame;
  catalogueGame: ScreenshotsGame;
}

interface GameScreenshotsBoxProps extends GameScreenshotsProps {
  showCommentCount: boolean;
}

function GameScreenshotsBox({
  libraryGame,
  catalogueGame,
  showCommentCount,
}: Readonly<GameScreenshotsBoxProps>) {
  const { t } = useTranslation("screenshots");
  const [modalTab, setModalTab] = useState<GameScreenshotsTab | null>(null);
  const [writeBus] = useState(createScreenshotWriteBus);
  const mine = useMyGameScreenshots({
    shop: libraryGame.shop,
    objectId: libraryGame.objectId,
    sort: "recent",
    take: SIDEBAR_SCREENSHOT_COUNT,
    isEnabled: true,
    writeBus,
  });
  const { collection } = mine;
  const { actions, lightbox } = collection;
  const topItems = mine.items.slice(0, SIDEBAR_SCREENSHOT_COUNT);
  const local = useLocalScreenshotActions();
  const viewer = useMyScreenshotsViewer({
    lightbox,
    feed: collection.feed,
    localScreenshots: mine.localScreenshots,
    hasLocalLoaded: mine.hasLoaded,
    uploadedItems: collection.feed.items,
    getUploadStatus: local.getUploadStatus,
  });
  const viewerEntries: MyScreenshotsEntry[] = mine.items.map((item) =>
    item.kind === "local"
      ? {
          kind: "local",
          time: item.screenshot.capturedAt,
          screenshot: item.screenshot,
        }
      : {
          kind: "uploaded",
          time: item.screenshot.capturedAt,
          screenshot: item.screenshot,
        }
  );
  const hasNoScreenshotsOfMine =
    mine.hasLoaded &&
    !mine.hasFailed &&
    !mine.isPartial &&
    topItems.length === 0;
  const community = useGameScreenshotsCollection({
    shop: catalogueGame.shop,
    objectId: catalogueGame.objectId,
    sort: "top",
    take: SIDEBAR_SCREENSHOT_COUNT,
    isEnabled: hasNoScreenshotsOfMine,
    writeBus,
  });
  const communityItems = community.feed.items.slice(
    0,
    SIDEBAR_SCREENSHOT_COUNT
  );

  const renderViewAllButton = (tab: GameScreenshotsTab) => (
    <Button
      theme="outline"
      className="game-screenshots-box__view-all"
      onClick={() => setModalTab(tab)}
    >
      {t("view_all")}
    </Button>
  );
  const viewAllButton = renderViewAllButton("mine");

  const renderSkeleton = () => (
    <>
      <div className="game-screenshots-box__grid" aria-busy="true">
        {Array.from({ length: SIDEBAR_SCREENSHOT_COUNT }, (_, index) => (
          <Skeleton
            key={`game-screenshots-box-skeleton-${index}`}
            className="game-screenshots-box__skeleton"
          />
        ))}
      </div>
      <Skeleton className="game-screenshots-box__view-all-skeleton" />
    </>
  );

  const renderCommunity = () => {
    const isCommunityLoading =
      !community.feed.hasLoaded && !community.feed.hasFailed;
    if (isCommunityLoading && communityItems.length === 0) {
      return renderSkeleton();
    }

    if (communityItems.length === 0) {
      return (
        <output className="game-screenshots-box__empty">
          <span className="game-screenshots-box__empty-title">
            <ImageIcon size={16} />
            {t("no_game_screenshots_yet")}
          </span>
          <GameScreenshotsHotkeyTip />
        </output>
      );
    }

    return (
      <>
        <ul className="game-screenshots-box__grid">
          {communityItems.map((screenshot) => (
            <li key={screenshot.id}>
              <GameScreenshotThumbnail
                screenshot={screenshot}
                isLiking={community.actions.likingIds.has(screenshot.id)}
                showCommentCount={showCommentCount}
                onOpen={community.lightbox.open}
                onLike={(item) => void community.actions.toggleLike(item)}
                onImageError={community.lightbox.refreshScreenshot}
              />
            </li>
          ))}
        </ul>

        {renderViewAllButton("community")}
      </>
    );
  };

  const renderContent = () => {
    if (!mine.hasLoaded) return renderSkeleton();

    if (mine.hasFailed) {
      return (
        <output className="game-screenshots-box__empty">
          <span className="game-screenshots-box__empty-title">
            <ImageIcon size={16} />
            {t("screenshots_load_failed")}
          </span>
          <Button theme="outline" onClick={mine.retry}>
            {t("retry")}
          </Button>
        </output>
      );
    }

    const partialNotice = mine.isPartial ? (
      <MyScreenshotsPartialNotice
        hasLocalFailed={mine.hasLocalFailed}
        onRetry={mine.retryFailed}
      />
    ) : null;

    if (topItems.length === 0 && partialNotice) {
      return (
        <>
          {partialNotice}
          {viewAllButton}
        </>
      );
    }

    if (topItems.length === 0) return renderCommunity();

    return (
      <>
        {partialNotice}
        <ul className="game-screenshots-box__grid">
          {topItems.map((item) => (
            <li key={item.id}>
              {item.kind === "published" ? (
                <GameScreenshotThumbnail
                  screenshot={item.screenshot}
                  isLiking={actions.likingIds.has(item.screenshot.id)}
                  showCommentCount={showCommentCount}
                  onOpen={(screenshot) =>
                    viewer.openEntry({
                      kind: "uploaded",
                      time: screenshot.capturedAt,
                      screenshot,
                    })
                  }
                  onLike={(screenshot) => void actions.toggleLike(screenshot)}
                  onImageError={lightbox.refreshScreenshot}
                />
              ) : (
                <LocalScreenshotTile
                  screenshot={item.screenshot}
                  alt={local.describe(item.screenshot)}
                  isBusy={local.busyIds.has(item.screenshot.clientId)}
                  uploadStatus={local.getUploadStatus(item.screenshot)}
                  onOpen={(screenshot) =>
                    viewer.openEntry({
                      kind: "local",
                      time: screenshot.capturedAt,
                      screenshot,
                    })
                  }
                  onDelete={local.requestDelete}
                />
              )}
            </li>
          ))}
        </ul>

        {viewAllButton}
      </>
    );
  };

  return (
    <SidebarSection
      title={
        hasNoScreenshotsOfMine
          ? t("community_screenshots_tab")
          : t("my_screenshots")
      }
    >
      <div className="game-screenshots-box">{renderContent()}</div>

      <MyScreenshotsLightbox
        collection={collection}
        entries={viewerEntries}
        openLocal={viewer.openLocal}
        describeLocal={local.describe}
        onOpenEntry={viewer.openEntry}
        onClose={viewer.close}
      />
      <ScreenshotLightbox collection={community} />
      {local.elements}

      <GameScreenshotsModal
        visible={modalTab !== null}
        showCommentCount={showCommentCount}
        libraryGame={libraryGame}
        catalogueGame={catalogueGame}
        writeBus={writeBus}
        initialTab={modalTab ?? "mine"}
        onClose={() => setModalTab(null)}
      />
    </SidebarSection>
  );
}

export function GameScreenshots({
  libraryGame,
  catalogueGame,
}: Readonly<GameScreenshotsProps>) {
  const { isFeatureEnabled, Feature } = useFeature();

  if (!isFeatureEnabled(Feature.Screenshots)) return null;

  return (
    <GameScreenshotsBox
      libraryGame={libraryGame}
      catalogueGame={catalogueGame}
      showCommentCount={isFeatureEnabled(Feature.ScreenshotComments)}
    />
  );
}
