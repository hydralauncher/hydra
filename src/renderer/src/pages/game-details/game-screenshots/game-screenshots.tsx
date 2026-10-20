import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { FlameIcon, HistoryIcon, ImageIcon } from "@primer/octicons-react";
import Skeleton from "react-loading-skeleton";
import cn from "classnames";

import { Button } from "@renderer/components";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  readStoredScreenshotSort,
  storeScreenshotPreference,
  useScreenshotCollection,
  type ScreenshotFeedPage,
} from "@renderer/components/screenshots";
import { useFeature, useUserDetails } from "@renderer/hooks";
import { GAME_SCREENSHOT_SORT_STORAGE_KEY } from "@renderer/session-state-keys";
import { buildGameScreenshotsPath } from "@shared";
import type { GameScreenshotsResponse, GameShop, ScreenshotSort } from "@types";

import "./game-screenshots.scss";

const GAME_SCREENSHOTS_PAGE_SIZE = 12;
const SKELETON_COUNT = 4;

const SORT_OPTIONS: { value: ScreenshotSort; icon: typeof HistoryIcon }[] = [
  { value: "recent", icon: HistoryIcon },
  { value: "top", icon: FlameIcon },
];

interface GameScreenshotsProps {
  shop: GameShop;
  objectId: string;
}

function GameScreenshotsSection({
  shop,
  objectId,
}: Readonly<GameScreenshotsProps>) {
  const { t } = useTranslation("screenshots");
  const { userDetails } = useUserDetails();
  const viewerId = userDetails?.id ?? null;
  const [sort, setSort] = useState<ScreenshotSort>(() =>
    readStoredScreenshotSort(GAME_SCREENSHOT_SORT_STORAGE_KEY)
  );

  const fetchPage = useCallback(
    async (cursor: string | null): Promise<ScreenshotFeedPage | null> => {
      const response =
        await window.electron.hydraApi.get<GameScreenshotsResponse>(
          buildGameScreenshotsPath({
            shop,
            objectId,
            cursor,
            sort,
            take: GAME_SCREENSHOTS_PAGE_SIZE,
          }),
          { needsAuth: Boolean(viewerId) }
        );

      return response ?? null;
    },
    [objectId, shop, sort, viewerId]
  );

  const collection = useScreenshotCollection({
    feedKey: [shop, objectId, sort, viewerId].join(":"),
    fetchPage,
  });
  const { feed, actions, lightbox } = collection;
  const isInitialLoading =
    !feed.hasLoaded || (feed.isLoading && feed.items.length === 0);

  const handleSortChange = (nextSort: ScreenshotSort) => {
    if (nextSort === sort) return;
    setSort(nextSort);
    storeScreenshotPreference(GAME_SCREENSHOT_SORT_STORAGE_KEY, nextSort);
  };

  const renderContent = () => {
    if (isInitialLoading) {
      return (
        <ul className="screenshot-grid" aria-busy="true">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <li key={`game-screenshot-skeleton-${index}`}>
              <Skeleton className="game-screenshots__skeleton" />
            </li>
          ))}
        </ul>
      );
    }

    if (feed.hasFailed) {
      return (
        <div className="game-screenshots__empty" role="status">
          <p>{t("screenshots_load_failed")}</p>
          <Button theme="outline" onClick={() => void feed.reload()}>
            {t("retry")}
          </Button>
        </div>
      );
    }

    if (feed.items.length === 0) {
      return (
        <div className="game-screenshots__empty" role="status">
          <ImageIcon size={20} />
          <p>{t("no_game_screenshots")}</p>
        </div>
      );
    }

    return (
      <>
        <ul className="screenshot-grid">
          {feed.items.map((screenshot) => (
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

        {feed.hasMore ? (
          <Button
            theme="outline"
            className="game-screenshots__load-more"
            disabled={feed.isLoading}
            onClick={() => void feed.loadMore()}
          >
            {feed.isLoading ? t("loading_screenshots") : t("load_more")}
          </Button>
        ) : null}
      </>
    );
  };

  return (
    <section
      className="game-screenshots"
      aria-labelledby="game-screenshots-title"
    >
      <div className="game-screenshots__header">
        <h2 id="game-screenshots-title" className="game-screenshots__title">
          {t("community_screenshots")}
        </h2>

        <div
          className="game-screenshots__sort"
          role="group"
          aria-label={t("sort_by")}
        >
          {SORT_OPTIONS.map(({ value, icon: Icon }) => (
            <button
              key={value}
              type="button"
              className={cn("game-screenshots__sort-option", {
                "game-screenshots__sort-option--active": sort === value,
              })}
              aria-pressed={sort === value}
              onClick={() => handleSortChange(value)}
            >
              <Icon size={14} />
              {t(`sort_${value}`)}
            </button>
          ))}
        </div>
      </div>

      {renderContent()}

      <ScreenshotLightbox collection={collection} />
    </section>
  );
}

export function GameScreenshots({
  shop,
  objectId,
}: Readonly<GameScreenshotsProps>) {
  const { isFeatureEnabled, Feature } = useFeature();

  if (shop === "custom" || !isFeatureEnabled(Feature.Screenshots)) {
    return null;
  }

  return <GameScreenshotsSection shop={shop} objectId={objectId} />;
}
