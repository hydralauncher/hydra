import "./styles.scss";

import {
  ArrowClockwiseIcon,
  ChatCircleIcon,
  EyeSlashIcon,
  HeartIcon,
  ImageIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ProfileScreenshot } from "@types";
import {
  buildGameScreenshotsPath,
  createScreenshotWriteBus,
  useScreenshotImageFallback,
} from "@shared";

import {
  Button,
  FocusItem,
  GridFocusGroup,
  Typography,
  UserProfileAvatar,
  VerticalFocusGroup,
} from "../../../common";
import {
  ScreenshotLightbox,
  getScreenshotAltText,
  shouldBlurScreenshot,
  useRevealedScreenshotSpoilers,
  useScreenshotFeed,
  useScreenshotLightbox,
} from "../../screenshots";
import { Feature, useFeature, useUserDetails } from "../../../../hooks";
import type { FocusOverrides, FocusOverrideTarget } from "../../../../services";
import {
  GAME_COMMUNITY_SCREENSHOTS_GRID_REGION_ID,
  GAME_COMMUNITY_SCREENSHOTS_REGION_ID,
  GAME_COMMUNITY_SCREENSHOTS_RETRY_ID,
  GAME_COMMUNITY_SCREENSHOTS_VIEW_ALL_ID,
  getGameCommunityScreenshotItemId,
} from "../navigation";
import { GameScreenshotsModal } from "./screenshots-modal";

const SIDEBAR_SCREENSHOT_COUNT = 4;
const SIDEBAR_COLUMNS = 2;
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

interface CommunityScreenshotThumbnailProps {
  screenshot: ProfileScreenshot;
  focusId: string;
  showCommentCount: boolean;
  navigationOverrides: FocusOverrides;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onRefreshImage: (screenshot: ProfileScreenshot) => Promise<void>;
}

function CommunityScreenshotThumbnail({
  screenshot,
  focusId,
  showCommentCount,
  navigationOverrides,
  onOpen,
  onRefreshImage,
}: Readonly<CommunityScreenshotThumbnailProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const revealedIds = useRevealedScreenshotSpoilers(
    (state) => state.revealedIds
  );
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const refreshImage = useCallback(
    () => onRefreshImage(screenshot),
    [onRefreshImage, screenshot]
  );
  const { hasImage, handleImageError } = useScreenshotImageFallback(
    imageUrl,
    refreshImage
  );
  const isBlurred = shouldBlurScreenshot(screenshot, revealedIds);
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return (
    <FocusItem id={focusId} navigationOverrides={navigationOverrides} asChild>
      <button
        type="button"
        className="game-community-screenshots__thumbnail"
        aria-label={getScreenshotAltText(screenshot, t, language)}
        onClick={() => onOpen(screenshot)}
      >
        {hasImage ? (
          <img
            className={cn("game-community-screenshots__image", {
              "game-community-screenshots__image--spoiler": isBlurred,
            })}
            src={imageUrl ?? undefined}
            alt=""
            draggable={false}
            loading="lazy"
            onError={() => void handleImageError()}
          />
        ) : (
          <span className="game-community-screenshots__placeholder">
            <ImageIcon size={24} />
          </span>
        )}

        <span className="game-community-screenshots__owner">
          <UserProfileAvatar
            image={screenshot.owner.profileImageUrl}
            alt=""
            className="game-community-screenshots__owner-avatar"
            fallbackClassName="game-community-screenshots__owner-avatar--fallback"
            width={18}
            height={18}
            iconSize={10}
          />
          <span className="game-community-screenshots__owner-name">
            {screenshot.owner.displayName}
          </span>
        </span>

        <span className="game-community-screenshots__stats">
          <span
            className="game-community-screenshots__stat"
            aria-label={t("screenshots_like_count", {
              count: screenshot.likeCount,
            })}
          >
            <HeartIcon
              size={12}
              weight={screenshot.likedByMe ? "fill" : "bold"}
            />
            {screenshot.likeCount}
          </span>
          {showCommentCount ? (
            <span
              className="game-community-screenshots__stat"
              aria-label={t("screenshots_comment_count", {
                count: screenshot.commentCount,
              })}
            >
              <ChatCircleIcon size={12} weight="bold" />
              {screenshot.commentCount}
            </span>
          ) : null}
        </span>

        {isBlurred ? (
          <span className="game-community-screenshots__spoiler">
            <EyeSlashIcon size={16} weight="bold" />
            {t("screenshots_spoiler")}
          </span>
        ) : null}
      </button>
    </FocusItem>
  );
}

const getThumbnailNavigation = (
  index: number,
  leftTarget: FocusOverrideTarget
): FocusOverrides =>
  index % SIDEBAR_COLUMNS === 0
    ? { left: leftTarget }
    : { right: BLOCK_TARGET };

interface CommunityScreenshotsContentProps {
  items: ProfileScreenshot[];
  isLoading: boolean;
  hasLoadError: boolean;
  showCommentCount: boolean;
  leftTarget: FocusOverrideTarget;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onRefreshImage: (screenshot: ProfileScreenshot) => Promise<void>;
  onRetry: () => void;
  onViewAll: () => void;
}

function CommunityScreenshotsContent({
  items,
  isLoading,
  hasLoadError,
  showCommentCount,
  leftTarget,
  onOpen,
  onRefreshImage,
  onRetry,
  onViewAll,
}: Readonly<CommunityScreenshotsContentProps>) {
  const { t } = useTranslation("big_picture");

  if (items.length > 0) {
    return (
      <>
        <GridFocusGroup
          regionId={GAME_COMMUNITY_SCREENSHOTS_GRID_REGION_ID}
          className="game-community-screenshots__grid"
        >
          {items.map((screenshot, index) => (
            <CommunityScreenshotThumbnail
              key={screenshot.id}
              screenshot={screenshot}
              focusId={getGameCommunityScreenshotItemId(screenshot.id)}
              showCommentCount={showCommentCount}
              navigationOverrides={getThumbnailNavigation(index, leftTarget)}
              onOpen={onOpen}
              onRefreshImage={onRefreshImage}
            />
          ))}
        </GridFocusGroup>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_COMMUNITY_SCREENSHOTS_VIEW_ALL_ID}
          className="game-community-screenshots__view-all"
          icon={<SquaresFourIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
          onClick={onViewAll}
        >
          {t("screenshots_view_all")}
        </Button>
      </>
    );
  }

  if (hasLoadError) {
    return (
      <div className="game-community-screenshots__message">
        <p>{t("screenshots_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_COMMUNITY_SCREENSHOTS_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          focusNavigationOverrides={{ left: leftTarget, right: BLOCK_TARGET }}
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  return (
    <div className="game-community-screenshots__message">
      <ImageIcon size={20} />
      <p>{t(isLoading ? "screenshots_loading" : "screenshots_empty_other")}</p>
    </div>
  );
}

export interface GameCommunityScreenshotsProps {
  shop: GameShop;
  objectId: string;
  isAdultGame: boolean;
  navigationOrder: number;
  leftTarget: FocusOverrideTarget;
}

export function GameCommunityScreenshots({
  shop,
  objectId,
  isAdultGame,
  navigationOrder,
  leftTarget,
}: Readonly<GameCommunityScreenshotsProps>) {
  const { t } = useTranslation("big_picture");
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled } = useFeature();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [writeBus] = useState(createScreenshotWriteBus);
  const isEnabled =
    isFeatureEnabled(Feature.Screenshots) && shop !== "custom" && !isAdultGame;
  const isSignedIn = Boolean(userDetails);

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildGameScreenshotsPath({
        shop,
        objectId,
        cursor,
        sort: "top",
        take: SIDEBAR_SCREENSHOT_COUNT,
      }),
    [objectId, shop]
  );

  const feed = useScreenshotFeed({
    requestKey: isEnabled ? `${shop}:${objectId}:sidebar` : null,
    buildPath,
    needsAuth: isSignedIn,
    writeBus,
  });
  const items = useMemo(
    () => feed.items.slice(0, SIDEBAR_SCREENSHOT_COUNT),
    [feed.items]
  );
  const { lightboxProps, open } = useScreenshotLightbox({
    items: feed.items,
    needsAuth: isSignedIn,
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

  if (!isEnabled) return null;

  return (
    <VerticalFocusGroup
      regionId={GAME_COMMUNITY_SCREENSHOTS_REGION_ID}
      navigationOrder={navigationOrder}
      asChild
    >
      <section
        className="game-page__sidebar-section game-community-screenshots"
        aria-label={t("screenshots_community_title")}
      >
        <div className="game-community-screenshots__title">
          <Typography>{t("screenshots_community_title")}</Typography>
        </div>
        <div className="game-community-screenshots__body">
          <CommunityScreenshotsContent
            items={items}
            isLoading={feed.isLoading}
            hasLoadError={feed.error === "initial"}
            showCommentCount={isFeatureEnabled(Feature.ScreenshotComments)}
            leftTarget={leftTarget}
            onOpen={open}
            onRefreshImage={feed.refreshImage}
            onRetry={feed.retry}
            onViewAll={() => setIsModalOpen(true)}
          />
        </div>

        <ScreenshotLightbox {...lightboxProps} />
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
