import "./styles.scss";

import {
  ArrowClockwiseIcon,
  ImageIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ProfileScreenshot } from "@types";
import { createScreenshotWriteBus, type MyScreenshotItem } from "@shared";

import {
  Button,
  GridFocusGroup,
  Typography,
  VerticalFocusGroup,
} from "../../../common";
import { ScreenshotLightbox, useScreenshotLightbox } from "../../screenshots";
import { Feature, useFeature } from "../../../../hooks";
import type { FocusOverrides, FocusOverrideTarget } from "../../../../services";
import {
  GAME_MY_SCREENSHOTS_GRID_REGION_ID,
  GAME_MY_SCREENSHOTS_REGION_ID,
  GAME_MY_SCREENSHOTS_RETRY_ID,
  GAME_MY_SCREENSHOTS_VIEW_ALL_ID,
  getGameMyScreenshotItemId,
} from "../navigation";
import { ScreenshotHotkeyHint } from "./hotkey-hint";
import { LocalScreenshotTile } from "./local-screenshot-tile";
import { MyScreenshotsPartialNotice } from "./partial-notice";
import { PublishedScreenshotThumbnail } from "./published-thumbnail";
import { GameScreenshotsModal } from "./screenshots-modal";
import {
  useLocalScreenshotActions,
  type LocalScreenshotActions,
} from "./use-local-screenshot-actions";
import { useMyGameScreenshots } from "./use-my-game-screenshots";

export { GameScreenshotsModal } from "./screenshots-modal";

const SIDEBAR_SCREENSHOT_COUNT = 4;
const SIDEBAR_COLUMNS = 2;
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

const getThumbnailNavigation = (
  index: number,
  leftTarget: FocusOverrideTarget
): FocusOverrides =>
  index % SIDEBAR_COLUMNS === 0
    ? { left: leftTarget }
    : { right: BLOCK_TARGET };

interface MyScreenshotsGridProps {
  items: MyScreenshotItem[];
  local: LocalScreenshotActions;
  showCommentCount: boolean;
  leftTarget: FocusOverrideTarget;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onRefreshImage: (screenshot: ProfileScreenshot) => Promise<void>;
}

function MyScreenshotsGrid({
  items,
  local,
  showCommentCount,
  leftTarget,
  onOpen,
  onRefreshImage,
}: Readonly<MyScreenshotsGridProps>) {
  return (
    <GridFocusGroup
      regionId={GAME_MY_SCREENSHOTS_GRID_REGION_ID}
      className="game-my-screenshots__grid"
    >
      {items.map((item, index) => {
        const focusId = getGameMyScreenshotItemId(item.id);
        const navigationOverrides = getThumbnailNavigation(index, leftTarget);

        return item.kind === "published" ? (
          <PublishedScreenshotThumbnail
            key={item.id}
            screenshot={item.screenshot}
            focusId={focusId}
            showCommentCount={showCommentCount}
            navigationOverrides={navigationOverrides}
            onOpen={onOpen}
            onRefreshImage={onRefreshImage}
          />
        ) : (
          <LocalScreenshotTile
            key={item.id}
            screenshot={item.screenshot}
            focusId={focusId}
            alt={local.describe(item.screenshot)}
            isBusy={local.busyIds.has(item.screenshot.clientId)}
            variant="thumbnail"
            navigationOverrides={navigationOverrides}
            onOpen={local.open}
            onUpload={local.upload}
            onDelete={local.requestDelete}
          />
        );
      })}
    </GridFocusGroup>
  );
}

interface MyScreenshotsMessageProps {
  isLoading: boolean;
  hasLoadError: boolean;
  leftTarget: FocusOverrideTarget;
  onRetry: () => void;
}

function MyScreenshotsMessage({
  isLoading,
  hasLoadError,
  leftTarget,
  onRetry,
}: Readonly<MyScreenshotsMessageProps>) {
  const { t } = useTranslation("big_picture");

  if (hasLoadError) {
    return (
      <div className="game-my-screenshots__message">
        <p>{t("screenshots_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_MY_SCREENSHOTS_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="game-my-screenshots__message">
        <ImageIcon size={20} />
        <p>{t("screenshots_loading")}</p>
      </div>
    );
  }

  return (
    <div className="game-my-screenshots__message">
      <ImageIcon size={20} />
      <p>{t("screenshots_empty_filtered")}</p>
      <ScreenshotHotkeyHint className="game-my-screenshots__hint" />
    </div>
  );
}

export interface GameMyScreenshotsProps {
  shop: GameShop;
  objectId: string;
  isAdultGame: boolean;
  navigationOrder: number;
  leftTarget: FocusOverrideTarget;
}

export function GameMyScreenshots({
  shop,
  objectId,
  isAdultGame,
  navigationOrder,
  leftTarget,
}: Readonly<GameMyScreenshotsProps>) {
  const { t } = useTranslation("big_picture");
  const { isFeatureEnabled } = useFeature();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [writeBus] = useState(createScreenshotWriteBus);
  const isEnabled = isFeatureEnabled(Feature.Screenshots) && !isAdultGame;
  const mine = useMyGameScreenshots({
    shop,
    objectId,
    sort: "recent",
    take: SIDEBAR_SCREENSHOT_COUNT,
    isEnabled,
    writeBus,
    feedKeySuffix: "sidebar",
  });
  const { feed } = mine;
  const local = useLocalScreenshotActions(mine.pendingLocal);
  const { lightboxProps, open } = useScreenshotLightbox({
    items: feed.items,
    needsAuth: true,
    updateItem: feed.updateItem,
    removeItem: feed.removeItem,
    getFetchedAt: feed.getFetchedAt,
    imageRefresher: feed.imageRefresher,
    subscribeRemoteWrites: feed.subscribeRemoteWrites,
    hasMore: feed.hasMore,
    loadMore: feed.loadMore,
    hasLoadMoreError: feed.error === "page",
    retryLoadMore: feed.retry,
  });
  const items = mine.items.slice(0, SIDEBAR_SCREENSHOT_COUNT);
  const showGrid = items.length > 0 && !mine.hasFailed;
  const showMessage = !showGrid && !mine.isPartial;
  const canViewAll = items.length > 0 || (shop !== "custom" && mine.hasLoaded);

  if (!isEnabled) return null;

  return (
    <VerticalFocusGroup
      regionId={GAME_MY_SCREENSHOTS_REGION_ID}
      navigationOrder={navigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-my-screenshots"
        aria-label={t("my_screenshots", { ns: "screenshots" })}
      >
        <div className="game-my-screenshots__title">
          <Typography>{t("my_screenshots", { ns: "screenshots" })}</Typography>
        </div>
        <div className="game-my-screenshots__body">
          {showGrid ? (
            <MyScreenshotsGrid
              items={items}
              local={local}
              showCommentCount={isFeatureEnabled(Feature.ScreenshotComments)}
              leftTarget={leftTarget}
              onOpen={open}
              onRefreshImage={feed.refreshImage}
            />
          ) : null}
          {showMessage ? (
            <MyScreenshotsMessage
              isLoading={!mine.hasLoaded}
              hasLoadError={mine.hasFailed}
              leftTarget={leftTarget}
              onRetry={mine.retry}
            />
          ) : null}
          <MyScreenshotsPartialNotice
            mine={mine}
            focusId={GAME_MY_SCREENSHOTS_RETRY_ID}
            className="game-my-screenshots__notice"
            navigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
          />
          {canViewAll ? (
            <Button
              variant="secondary"
              size="small"
              focusId={GAME_MY_SCREENSHOTS_VIEW_ALL_ID}
              className="game-my-screenshots__view-all"
              icon={<SquaresFourIcon size={18} />}
              focusNavigationOverrides={{
                left: leftTarget,
                right: BLOCK_TARGET,
              }}
              onClick={() => setIsModalOpen(true)}
            >
              {t("screenshots_view_all")}
            </Button>
          ) : null}
        </div>

        <ScreenshotLightbox {...lightboxProps} />
        {local.elements}
        <GameScreenshotsModal
          visible={isModalOpen}
          shop={shop}
          objectId={objectId}
          writeBus={writeBus}
          onClose={() => setIsModalOpen(false)}
        />
      </section>
    </VerticalFocusGroup>
  );
}
