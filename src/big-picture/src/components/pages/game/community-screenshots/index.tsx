import "./styles.scss";

import { ArrowClockwiseIcon, SortAscendingIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ProfileScreenshot, ScreenshotSort } from "@types";
import { buildGameScreenshotsPath } from "@shared";
import { logger } from "@renderer/logger";

import {
  Button,
  DropdownSelect,
  Typography,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../../../common";
import {
  ScreenshotLightbox,
  ScreenshotRow,
  useScreenshotFeed,
  useScreenshotLightbox,
} from "../../screenshots";
import { Feature, useFeature, useUserDetails } from "../../../../hooks";
import { getItemFocusTarget } from "../../../../helpers";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../../../layout";
import type { FocusOverrideTarget } from "../../../../services";
import {
  GAME_COMMUNITY_SCREENSHOTS_LOAD_MORE_RETRY_ID,
  GAME_COMMUNITY_SCREENSHOTS_REGION_ID,
  GAME_COMMUNITY_SCREENSHOTS_RETRY_ID,
  GAME_COMMUNITY_SCREENSHOTS_ROW_REGION_ID,
  GAME_COMMUNITY_SCREENSHOTS_SORT_ID,
  getGameCommunityScreenshotItemId,
} from "../navigation";

const SORT_STORAGE_KEY = "big-picture:game-screenshots-sort";
const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };

function readStoredSort(): ScreenshotSort {
  try {
    return globalThis.window.localStorage.getItem(SORT_STORAGE_KEY) === "top"
      ? "top"
      : "recent";
  } catch {
    return "recent";
  }
}

function storeSort(sort: ScreenshotSort) {
  try {
    globalThis.window.localStorage.setItem(SORT_STORAGE_KEY, sort);
  } catch (error) {
    logger.warn("Failed to remember screenshot sort", error);
  }
}

function getSortDownTarget(
  firstItem: ProfileScreenshot | undefined,
  hasLoadError: boolean,
  downTarget: FocusOverrideTarget | undefined
): FocusOverrideTarget {
  if (firstItem)
    return getItemFocusTarget(getGameCommunityScreenshotItemId(firstItem.id));
  if (hasLoadError)
    return getItemFocusTarget(GAME_COMMUNITY_SCREENSHOTS_RETRY_ID);

  return downTarget ?? BLOCK_TARGET;
}

export interface GameCommunityScreenshotsProps {
  shop: GameShop;
  objectId: string;
  isAdultGame: boolean;
  upTarget?: FocusOverrideTarget;
  downTarget?: FocusOverrideTarget;
  onAvailabilityChange: (hasScreenshots: boolean) => void;
}

export function GameCommunityScreenshots({
  shop,
  objectId,
  isAdultGame,
  upTarget,
  downTarget,
  onAvailabilityChange,
}: Readonly<GameCommunityScreenshotsProps>) {
  const { t } = useTranslation("big_picture");
  const { userDetails } = useUserDetails();
  const { isFeatureEnabled } = useFeature();
  const [sort, setSort] = useState<ScreenshotSort>(readStoredSort);
  const isEnabled =
    isFeatureEnabled(Feature.Screenshots) && shop !== "custom" && !isAdultGame;
  const isSignedIn = Boolean(userDetails);

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildGameScreenshotsPath({ shop, objectId, cursor, sort }),
    [objectId, shop, sort]
  );

  const feed = useScreenshotFeed({
    requestKey: isEnabled ? `${shop}:${objectId}:${sort}` : null,
    buildPath,
    needsAuth: isSignedIn,
  });
  const { lightboxProps, open } = useScreenshotLightbox({
    items: feed.items,
    needsAuth: isSignedIn,
    updateItem: feed.updateItem,
    removeItem: feed.removeItem,
    getFetchedAt: feed.getFetchedAt,
  });
  const gameKey = `${shop}:${objectId}`;
  const [populatedGameKey, setPopulatedGameKey] = useState<string | null>(null);
  const hasScreenshots = feed.items.length > 0;
  const hasLoadError = feed.error === "initial";
  const isVisible =
    isEnabled &&
    (hasScreenshots || hasLoadError || populatedGameKey === gameKey);

  useEffect(() => {
    if (hasScreenshots) setPopulatedGameKey(gameKey);
  }, [gameKey, hasScreenshots]);

  useEffect(() => {
    onAvailabilityChange(isVisible);
  }, [isVisible, onAvailabilityChange]);

  useEffect(() => () => onAvailabilityChange(false), [onAvailabilityChange]);

  const sortOptions = useMemo<DropdownSelectOption<ScreenshotSort>[]>(
    () => [
      { value: "recent", label: t("screenshots_sort_recent") },
      { value: "top", label: t("screenshots_sort_top") },
    ],
    [t]
  );

  const firstItem = feed.items[0];
  const firstItemTarget = getSortDownTarget(
    firstItem,
    hasLoadError,
    downTarget
  );

  if (!isVisible) {
    return <ScreenshotLightbox {...lightboxProps} />;
  }

  return (
    <VerticalFocusGroup
      regionId={GAME_COMMUNITY_SCREENSHOTS_REGION_ID}
      className="game-community-screenshots"
      asChild
    >
      <section aria-label={t("screenshots_community_title")}>
        <header className="game-community-screenshots__header">
          <Typography className="game-community-screenshots__title">
            {t("screenshots_community_title")}
          </Typography>
          <DropdownSelect
            className="game-community-screenshots__sort"
            label={t("screenshots_sort_label")}
            hideLabel
            leadingIcon={<SortAscendingIcon size={20} />}
            ariaLabel={t("screenshots_sort_label")}
            value={sort}
            options={sortOptions}
            focusId={GAME_COMMUNITY_SCREENSHOTS_SORT_ID}
            focusNavigationOverrides={{
              up: upTarget ?? BLOCK_TARGET,
              down: firstItemTarget,
              left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
              right: BLOCK_TARGET,
            }}
            onValueChange={(nextSort) => {
              setSort(nextSort);
              storeSort(nextSort);
            }}
          />
        </header>

        {hasScreenshots ? (
          <ScreenshotRow
            regionId={GAME_COMMUNITY_SCREENSHOTS_ROW_REGION_ID}
            items={feed.items}
            getItemFocusId={(screenshot) =>
              getGameCommunityScreenshotItemId(screenshot.id)
            }
            showOwnerDetails={false}
            showAuthor
            hasMore={feed.hasMore}
            isLoadingMore={feed.isLoadingMore}
            upTarget={getItemFocusTarget(GAME_COMMUNITY_SCREENSHOTS_SORT_ID)}
            downTarget={downTarget}
            leftTarget={getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home)}
            hasLoadMoreError={feed.error === "page"}
            retryFocusId={GAME_COMMUNITY_SCREENSHOTS_LOAD_MORE_RETRY_ID}
            onRetryLoadMore={feed.retry}
            onLoadMore={() => void feed.loadMore()}
            onActivate={open}
          />
        ) : null}

        {!hasScreenshots && hasLoadError ? (
          <div className="game-community-screenshots__error">
            <p>{t("screenshots_load_failed")}</p>
            <Button
              variant="secondary"
              size="small"
              focusId={GAME_COMMUNITY_SCREENSHOTS_RETRY_ID}
              icon={<ArrowClockwiseIcon size={18} />}
              focusNavigationOverrides={{
                up: getItemFocusTarget(GAME_COMMUNITY_SCREENSHOTS_SORT_ID),
                down: downTarget ?? BLOCK_TARGET,
                left: getItemFocusTarget(BIG_PICTURE_SIDEBAR_ITEM_IDS.home),
                right: BLOCK_TARGET,
              }}
              onClick={feed.retry}
            >
              {t("screenshots_retry")}
            </Button>
          </div>
        ) : null}

        {!hasScreenshots && !hasLoadError ? (
          <p className="game-community-screenshots__loading">
            {t(
              feed.isLoading ? "screenshots_loading" : "screenshots_empty_other"
            )}
          </p>
        ) : null}

        <ScreenshotLightbox {...lightboxProps} />
      </section>
    </VerticalFocusGroup>
  );
}
