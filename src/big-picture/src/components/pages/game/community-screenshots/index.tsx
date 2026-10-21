import "./styles.scss";

import {
  ArrowClockwiseIcon,
  EyeSlashIcon,
  ImageIcon,
  SquaresFourIcon,
} from "@phosphor-icons/react";
import cn from "classnames";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ProfileScreenshot } from "@types";
import { buildGameScreenshotsPath } from "@shared";

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
  navigationOverrides: FocusOverrides;
  onOpen: (screenshot: ProfileScreenshot) => void;
}

function CommunityScreenshotThumbnail({
  screenshot,
  focusId,
  navigationOverrides,
  onOpen,
}: Readonly<CommunityScreenshotThumbnailProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const revealedIds = useRevealedScreenshotSpoilers(
    (state) => state.revealedIds
  );
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const imageUrl = screenshot.thumbnailUrl ?? screenshot.imageUrl;
  const hasImage = Boolean(imageUrl && imageUrl !== failedImageUrl);
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
            onError={() => setFailedImageUrl(imageUrl)}
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
  leftTarget: FocusOverrideTarget;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onRetry: () => void;
  onViewAll: () => void;
}

function CommunityScreenshotsContent({
  items,
  isLoading,
  hasLoadError,
  leftTarget,
  onOpen,
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
              navigationOverrides={getThumbnailNavigation(index, leftTarget)}
              onOpen={onOpen}
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
  });
  const items = useMemo(
    () => feed.items.slice(0, SIDEBAR_SCREENSHOT_COUNT),
    [feed.items]
  );
  const { lightboxProps, open } = useScreenshotLightbox({
    items,
    needsAuth: isSignedIn,
    updateItem: feed.updateItem,
    removeItem: feed.removeItem,
    getFetchedAt: feed.getFetchedAt,
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
            leftTarget={leftTarget}
            onOpen={open}
            onRetry={feed.retry}
            onViewAll={() => setIsModalOpen(true)}
          />
        </div>

        <ScreenshotLightbox {...lightboxProps} />
        <GameScreenshotsModal
          visible={isModalOpen}
          shop={shop}
          objectId={objectId}
          onClose={() => setIsModalOpen(false)}
        />
      </section>
    </VerticalFocusGroup>
  );
}
