import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { ScreenshotLightbox } from "@renderer/components/screenshots";
import { useFeature } from "@renderer/hooks";
import type { GameShop } from "@types";

import { SidebarSection } from "../sidebar-section/sidebar-section";
import { GameScreenshotThumbnail } from "./game-screenshot-thumbnail";
import { GameScreenshotsModal } from "./game-screenshots-modal";
import { useGameScreenshotsCollection } from "./use-game-screenshots-collection";

import "./game-screenshots.scss";

const SIDEBAR_SCREENSHOT_COUNT = 2;

interface GameScreenshotsBoxProps {
  shop: GameShop;
  objectId: string;
}

function GameScreenshotsBox({
  shop,
  objectId,
}: Readonly<GameScreenshotsBoxProps>) {
  const { t } = useTranslation("screenshots");
  const [isModalVisible, setIsModalVisible] = useState(false);
  const collection = useGameScreenshotsCollection({
    shop,
    objectId,
    sort: "top",
    take: SIDEBAR_SCREENSHOT_COUNT,
    isEnabled: true,
  });
  const { feed, lightbox } = collection;
  const topItems = feed.items.slice(0, SIDEBAR_SCREENSHOT_COUNT);
  const isInitialLoading =
    !feed.hasLoaded || (feed.isLoading && feed.items.length === 0);

  const renderContent = () => {
    if (isInitialLoading) {
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
          <ImageIcon size={16} />
          <span>{t("no_screenshots")}</span>
        </output>
      );
    }

    return (
      <>
        <ul className="game-screenshots-box__grid">
          {topItems.map((screenshot) => (
            <li key={screenshot.id}>
              <GameScreenshotThumbnail
                screenshot={screenshot}
                onOpen={lightbox.open}
              />
            </li>
          ))}
        </ul>

        <Button
          theme="outline"
          className="game-screenshots-box__view-all"
          onClick={() => setIsModalVisible(true)}
        >
          {t("view_all")}
        </Button>
      </>
    );
  };

  return (
    <SidebarSection title={t("community_screenshots")}>
      <div className="game-screenshots-box">{renderContent()}</div>

      <ScreenshotLightbox collection={collection} />

      <GameScreenshotsModal
        visible={isModalVisible}
        shop={shop}
        objectId={objectId}
        onClose={() => setIsModalVisible(false)}
      />
    </SidebarSection>
  );
}

interface GameScreenshotsProps extends GameScreenshotsBoxProps {
  isAdultGame: boolean;
}

export function GameScreenshots({
  shop,
  objectId,
  isAdultGame,
}: Readonly<GameScreenshotsProps>) {
  const { isFeatureEnabled, Feature } = useFeature();

  if (
    shop === "custom" ||
    isAdultGame ||
    !isFeatureEnabled(Feature.Screenshots)
  ) {
    return null;
  }

  return <GameScreenshotsBox shop={shop} objectId={objectId} />;
}
