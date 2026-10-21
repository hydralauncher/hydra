import {
  ArrowClockwiseIcon,
  ImageIcon,
  SortAscendingIcon,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ProfileScreenshot, ScreenshotSort } from "@types";
import {
  INITIAL_SCREENSHOT_SPOILER_PAGING,
  buildGameScreenshotsPath,
  resumeSpoilerPaging,
  shouldAutoLoadSpoilerPage,
  trackSpoilerPaging,
  type ScreenshotWriteBus,
} from "@shared";
import { logger } from "@renderer/logger";

import {
  Button,
  Checkbox,
  DropdownSelect,
  GridFocusGroup,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
  type DropdownSelectOption,
} from "../../../common";
import {
  ScreenshotCard,
  ScreenshotLightbox,
  useScreenshotFeed,
  useScreenshotLightbox,
} from "../../screenshots";
import { useUserDetails } from "../../../../hooks";
import {
  GAME_SCREENSHOTS_MODAL_GRID_REGION_ID,
  GAME_SCREENSHOTS_MODAL_LOAD_MORE_ID,
  GAME_SCREENSHOTS_MODAL_REGION_ID,
  GAME_SCREENSHOTS_MODAL_RETRY_ID,
  GAME_SCREENSHOTS_MODAL_SORT_ID,
  GAME_SCREENSHOTS_MODAL_SPOILERS_ID,
  GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID,
  getGameScreenshotsModalItemId,
} from "../navigation";

const SORT_STORAGE_KEY = "big-picture:game-screenshots-sort";
const MODAL_PAGE_SIZE = 24;

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

const hideSpoilerScreenshots = (
  items: ProfileScreenshot[],
  hideSpoilers: boolean
) => (hideSpoilers ? items.filter((item) => !item.isSpoiler) : items);

interface ScreenshotsModalGridProps {
  items: ProfileScreenshot[];
  hasAnyItems: boolean;
  isLoading: boolean;
  hasLoadError: boolean;
  onOpen: (screenshot: ProfileScreenshot) => void;
  onRefreshImage: (screenshot: ProfileScreenshot) => Promise<void>;
  onRetry: () => void;
}

function ScreenshotsModalGrid({
  items,
  hasAnyItems,
  isLoading,
  hasLoadError,
  onOpen,
  onRefreshImage,
  onRetry,
}: Readonly<ScreenshotsModalGridProps>) {
  const { t } = useTranslation("big_picture");

  if (items.length > 0) {
    return (
      <GridFocusGroup
        regionId={GAME_SCREENSHOTS_MODAL_GRID_REGION_ID}
        className="game-screenshots-modal__grid"
      >
        <ul className="game-screenshots-modal__list">
          {items.map((screenshot) => (
            <ScreenshotCard
              key={screenshot.id}
              screenshot={screenshot}
              focusId={getGameScreenshotsModalItemId(screenshot.id)}
              showOwnerDetails={false}
              showAuthor
              onActivate={onOpen}
              onRefreshImage={onRefreshImage}
            />
          ))}
        </ul>
      </GridFocusGroup>
    );
  }

  if (hasLoadError) {
    return (
      <div className="game-screenshots-modal__message">
        <p>{t("screenshots_load_failed")}</p>
        <Button
          variant="secondary"
          size="small"
          focusId={GAME_SCREENSHOTS_MODAL_RETRY_ID}
          icon={<ArrowClockwiseIcon size={18} />}
          onClick={onRetry}
        >
          {t("screenshots_retry")}
        </Button>
      </div>
    );
  }

  const messageKey = hasAnyItems
    ? "screenshots_all_spoilers"
    : "screenshots_empty_other";

  return (
    <div className="game-screenshots-modal__message">
      <ImageIcon size={28} />
      <p>{t(isLoading ? "screenshots_loading" : messageKey)}</p>
    </div>
  );
}

export interface GameScreenshotsModalProps {
  visible: boolean;
  shop: GameShop;
  objectId: string;
  writeBus?: ScreenshotWriteBus;
  onClose: () => void;
}

export function GameScreenshotsModal({
  visible,
  shop,
  objectId,
  writeBus,
  onClose,
}: Readonly<GameScreenshotsModalProps>) {
  const { t } = useTranslation("big_picture");
  const { userDetails } = useUserDetails();
  const [sort, setSort] = useState<ScreenshotSort>(readStoredSort);
  const [hideSpoilers, setHideSpoilers] = useState(false);
  const isSignedIn = Boolean(userDetails);

  const buildPath = useCallback(
    (cursor: string | null) =>
      buildGameScreenshotsPath({
        shop,
        objectId,
        cursor,
        sort,
        take: MODAL_PAGE_SIZE,
      }),
    [objectId, shop, sort]
  );

  const feed = useScreenshotFeed({
    requestKey: visible ? `${shop}:${objectId}:${sort}:all` : null,
    buildPath,
    needsAuth: isSignedIn,
    writeBus,
  });
  const visibleItems = useMemo(
    () => hideSpoilerScreenshots(feed.items, hideSpoilers),
    [feed.items, hideSpoilers]
  );
  const { lightboxProps, open } = useScreenshotLightbox({
    items: visibleItems,
    needsAuth: isSignedIn,
    updateItem: feed.updateItem,
    removeItem: feed.removeItem,
    getFetchedAt: feed.getFetchedAt,
    imageRefresher: feed.imageRefresher,
    subscribeRemoteWrites: feed.subscribeRemoteWrites,
  });
  const canLoadMore = feed.hasMore && !feed.isLoadingMore && !feed.error;
  const { loadMore } = feed;

  const requestMore = useCallback(() => {
    loadMore().catch((error: unknown) => {
      logger.error("Failed to load more game screenshots", error);
    });
  }, [loadMore]);

  const spoilerPagingRef = useRef(INITIAL_SCREENSHOT_SPOILER_PAGING);
  const loadedCount = feed.items.length;
  const visibleCount = visibleItems.length;

  useEffect(() => {
    const paging = trackSpoilerPaging(
      spoilerPagingRef.current,
      loadedCount,
      visibleCount
    );
    spoilerPagingRef.current = paging;

    if (shouldAutoLoadSpoilerPage({ hideSpoilers, canLoadMore, paging })) {
      requestMore();
    }
  }, [canLoadMore, hideSpoilers, loadedCount, requestMore, visibleCount]);

  const loadNextPage = () => {
    if (feed.error === "page") {
      feed.retry();
      return;
    }

    spoilerPagingRef.current = resumeSpoilerPaging(spoilerPagingRef.current);
    requestMore();
  };

  const sortOptions = useMemo<DropdownSelectOption<ScreenshotSort>[]>(
    () => [
      { value: "recent", label: t("screenshots_sort_recent") },
      { value: "top", label: t("screenshots_sort_top") },
    ],
    [t]
  );

  return (
    <>
      <Modal
        visible={visible}
        title={t("screenshots_community_title")}
        onClose={onClose}
        className="game-screenshots-modal"
        initialFocusId={GAME_SCREENSHOTS_MODAL_SORT_ID}
      >
        <VerticalFocusGroup regionId={GAME_SCREENSHOTS_MODAL_REGION_ID} asChild>
          <div className="game-screenshots-modal__content">
            <HorizontalFocusGroup
              regionId={GAME_SCREENSHOTS_MODAL_TOOLBAR_REGION_ID}
              asChild
            >
              <div className="game-screenshots-modal__toolbar">
                <DropdownSelect
                  className="game-screenshots-modal__sort"
                  label={t("screenshots_sort_label")}
                  hideLabel
                  leadingIcon={<SortAscendingIcon size={20} />}
                  ariaLabel={t("screenshots_sort_label")}
                  value={sort}
                  options={sortOptions}
                  focusId={GAME_SCREENSHOTS_MODAL_SORT_ID}
                  onValueChange={(nextSort) => {
                    setSort(nextSort);
                    storeSort(nextSort);
                  }}
                />
                <Checkbox
                  label={t("screenshots_hide_spoilers")}
                  checked={hideSpoilers}
                  focusId={GAME_SCREENSHOTS_MODAL_SPOILERS_ID}
                  onChange={setHideSpoilers}
                />
              </div>
            </HorizontalFocusGroup>

            <div className="game-screenshots-modal__scroll">
              <ScreenshotsModalGrid
                items={visibleItems}
                hasAnyItems={feed.items.length > 0}
                isLoading={feed.isLoading}
                hasLoadError={feed.error === "initial"}
                onOpen={open}
                onRefreshImage={feed.refreshImage}
                onRetry={feed.retry}
              />

              {feed.hasMore && feed.items.length > 0 ? (
                <Button
                  variant="secondary"
                  size="small"
                  focusId={GAME_SCREENSHOTS_MODAL_LOAD_MORE_ID}
                  className="game-screenshots-modal__load-more"
                  loading={feed.isLoadingMore}
                  onClick={loadNextPage}
                >
                  {t(
                    feed.error === "page"
                      ? "screenshots_retry"
                      : "screenshots_load_more"
                  )}
                </Button>
              ) : null}
            </div>
          </div>
        </VerticalFocusGroup>
      </Modal>

      <ScreenshotLightbox {...lightboxProps} />
    </>
  );
}
