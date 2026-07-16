import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CheckIcon } from "@primer/octicons-react";
import type { ArtworkAssetType, ArtworkItem, LibraryGame } from "@types";
import {
  getArtworkDisplaySource,
  useGameArtworkGrid,
} from "@renderer/hooks/use-game-artwork-grid";

import { FocusItem, GridFocusGroup } from "../../../common";
import { useBigPictureToast, useUserDetails } from "../../../../hooks";
import { useArtworkGridNavigation } from "./use-artwork-grid-navigation";

import "./artwork-picker.scss";

const ARTWORK_GRID_REGION_ID = "game-artwork-grid";
const ARTWORK_PREVIEW_FOCUS_ID = "game-customization-settings-asset-preview";
const SENTINEL_ROOT_MARGIN = "320px 0px";

const INITIAL_SKELETON_COUNT: Record<ArtworkAssetType, number> = {
  icon: 18,
  grid: 8,
  hero: 6,
  logo: 9,
};
const MORE_SKELETON_COUNT = 4;

const getTileFocusId = (id: number) => `game-artwork-tile-${id}`;

interface GameArtworkPickerProps {
  game: LibraryGame;
  assetType: ArtworkAssetType;
  onChanged: () => Promise<void> | void;
}

export function GameArtworkPicker({
  game,
  assetType,
  onChanged,
}: Readonly<GameArtworkPickerProps>) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const { userDetails } = useUserDetails();

  const onError = useCallback(() => {
    showErrorToast(t("steamgriddb_fetch_failed"));
  }, [showErrorToast, t]);

  const onPicked = useCallback(() => {
    showSuccessToast(t("steamgriddb_artwork_updated"));
  }, [showSuccessToast, t]);

  const {
    items,
    currentArtworkId,
    isLoading,
    hasMore,
    pendingId,
    loadNextPage,
    pick,
  } = useGameArtworkGrid({
    shop: game.shop,
    objectId: game.objectId,
    assetType,
    enabled: Boolean(userDetails),
    onChanged,
    onError,
    onPicked,
  });

  const handlePickItem = useCallback(
    (item: ArtworkItem) => {
      pick(item).catch(() => {});
    },
    [pick]
  );

  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadNextPage();
      },
      { rootMargin: SENTINEL_ROOT_MARGIN }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, loadNextPage, items.length]);

  const tileFocusIds = items.map((item) => getTileFocusId(item.id));
  const overridesByItemId = useArtworkGridNavigation(
    tileFocusIds,
    ARTWORK_PREVIEW_FOCUS_ID
  );

  if (!userDetails) {
    return (
      <p className="game-artwork-picker__hint">
        {t("steamgriddb_sign_in_required")}
      </p>
    );
  }

  const skeletonCount = items.length
    ? MORE_SKELETON_COUNT
    : INITIAL_SKELETON_COUNT[assetType];
  const skeletonKeys = Array.from(
    { length: skeletonCount },
    (_, index) => `game-artwork-skeleton-${index}`
  );

  return (
    <div className="game-artwork-picker">
      <div className="game-artwork-picker__header">
        <span className="game-artwork-picker__title">
          {t("steamgriddb_section_title")}
        </span>
      </div>

      <GridFocusGroup
        regionId={ARTWORK_GRID_REGION_ID}
        className={`game-artwork-picker__grid game-artwork-picker__grid--${assetType}`}
      >
        {items.map((item) => (
          <FocusItem
            key={item.id}
            id={getTileFocusId(item.id)}
            actions={{ primary: () => handlePickItem(item) }}
            navigationOverrides={overridesByItemId[getTileFocusId(item.id)]}
            asChild
          >
            <button
              type="button"
              className={`game-artwork-picker__item game-artwork-picker__item--${assetType} ${
                currentArtworkId === item.id
                  ? "game-artwork-picker__item--active"
                  : ""
              }`}
              onClick={() => handlePickItem(item)}
            >
              {(() => {
                const display = getArtworkDisplaySource(item);
                return display.isVideo ? (
                  <video
                    src={display.src}
                    autoPlay
                    loop
                    muted
                    playsInline
                    disablePictureInPicture
                  />
                ) : (
                  <img src={display.src} alt="" loading="lazy" />
                );
              })()}
              {currentArtworkId === item.id ? (
                <span
                  className="game-artwork-picker__item-check"
                  aria-hidden="true"
                >
                  <CheckIcon size={14} />
                </span>
              ) : null}
              {pendingId === item.id ? (
                <span
                  className="game-artwork-picker__item-spinner"
                  aria-hidden="true"
                />
              ) : null}
            </button>
          </FocusItem>
        ))}

        {isLoading
          ? skeletonKeys.map((key) => (
              <div
                key={key}
                className={`game-artwork-picker__item game-artwork-picker__item--${assetType} game-artwork-picker__item--skeleton`}
                aria-hidden
              />
            ))
          : null}

        {!!items.length && hasMore ? (
          <div
            ref={sentinelRef}
            className="game-artwork-picker__sentinel"
            aria-hidden
          />
        ) : null}
      </GridFocusGroup>

      {!isLoading && !items.length ? (
        <p className="game-artwork-picker__hint">
          {t("steamgriddb_no_results")}
        </p>
      ) : null}
    </div>
  );
}
