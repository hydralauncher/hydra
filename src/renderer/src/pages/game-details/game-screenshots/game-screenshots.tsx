import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { ScreenshotLightbox } from "@renderer/components/screenshots";
import { useFeature } from "@renderer/hooks";
import { createScreenshotWriteBus } from "@shared";
import type { GameShop } from "@types";

import { SidebarSection } from "../sidebar-section/sidebar-section";
import { GameScreenshotThumbnail } from "./game-screenshot-thumbnail";
import { GameScreenshotsHotkeyTip } from "./game-screenshots-hotkey-tip";
import { GameScreenshotsModal } from "./game-screenshots-modal";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { useLocalScreenshotActions } from "./use-local-screenshot-actions";
import { useMyGameScreenshots } from "./use-my-game-screenshots";

import "./game-screenshots.scss";

const SIDEBAR_SCREENSHOT_COUNT = 4;

interface GameScreenshotsBoxProps {
  shop: GameShop;
  objectId: string;
  showCommentCount: boolean;
}

function GameScreenshotsBox({
  shop,
  objectId,
  showCommentCount,
}: Readonly<GameScreenshotsBoxProps>) {
  const { t } = useTranslation("screenshots");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [writeBus] = useState(createScreenshotWriteBus);
  const mine = useMyGameScreenshots({
    shop,
    objectId,
    sort: "recent",
    take: SIDEBAR_SCREENSHOT_COUNT,
    isEnabled: true,
    writeBus,
  });
  const { collection } = mine;
  const { actions, lightbox } = collection;
  const topItems = mine.items.slice(0, SIDEBAR_SCREENSHOT_COUNT);
  const local = useLocalScreenshotActions(mine.pendingLocal);

  const viewAllButton = (
    <Button
      theme="outline"
      className="game-screenshots-box__view-all"
      onClick={() => setIsModalVisible(true)}
    >
      {t("view_all")}
    </Button>
  );

  const renderContent = () => {
    if (!mine.hasLoaded) {
      return (
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
    }

    if (topItems.length === 0) {
      return (
        <output className="game-screenshots-box__empty">
          <span className="game-screenshots-box__empty-title">
            <ImageIcon size={16} />
            {t("no_game_screenshots_yet")}
          </span>
          <GameScreenshotsHotkeyTip />
          {shop === "custom" ? null : viewAllButton}
        </output>
      );
    }

    return (
      <>
        <ul className="game-screenshots-box__grid">
          {topItems.map((item) => (
            <li key={item.id}>
              {item.kind === "published" ? (
                <GameScreenshotThumbnail
                  screenshot={item.screenshot}
                  isLiking={actions.likingIds.has(item.screenshot.id)}
                  showCommentCount={showCommentCount}
                  showOwner={false}
                  onOpen={lightbox.open}
                  onLike={(screenshot) => void actions.toggleLike(screenshot)}
                  onImageError={lightbox.refreshScreenshot}
                />
              ) : (
                <LocalScreenshotTile
                  screenshot={item.screenshot}
                  alt={local.describe(item.screenshot)}
                  isBusy={local.busyIds.has(item.screenshot.clientId)}
                  onOpen={local.open}
                  onUpload={local.upload}
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
    <SidebarSection title={t("my_screenshots")}>
      <div className="game-screenshots-box">{renderContent()}</div>

      <ScreenshotLightbox collection={collection} />
      {local.elements}

      <GameScreenshotsModal
        visible={isModalVisible}
        showCommentCount={showCommentCount}
        shop={shop}
        objectId={objectId}
        writeBus={writeBus}
        onClose={() => setIsModalVisible(false)}
      />
    </SidebarSection>
  );
}

interface GameScreenshotsProps {
  shop: GameShop;
  objectId: string;
  isAdultGame: boolean;
}

export function GameScreenshots({
  shop,
  objectId,
  isAdultGame,
}: Readonly<GameScreenshotsProps>) {
  const { isFeatureEnabled, Feature } = useFeature();

  if (isAdultGame || !isFeatureEnabled(Feature.Screenshots)) return null;

  return (
    <GameScreenshotsBox
      shop={shop}
      objectId={objectId}
      showCommentCount={isFeatureEnabled(Feature.ScreenshotComments)}
    />
  );
}
