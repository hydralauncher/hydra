import { useCallback, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { useGameArtworkGrid, useToast, useUserDetails } from "@renderer/hooks";
import type { ArtworkAssetType, LibraryGame } from "@types";

import "./game-artwork-picker.scss";

const SENTINEL_ROOT_MARGIN = "200px";

const INITIAL_SKELETON_COUNT: Record<ArtworkAssetType, number> = {
  icon: 28,
  grid: 12,
  hero: 8,
  logo: 12,
};
const MORE_SKELETON_COUNT = 4;

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
  const { t } = useTranslation("sidebar");
  const { showErrorToast } = useToast();
  const { userDetails } = useUserDetails();

  const onError = useCallback(() => {
    showErrorToast(t("steamgriddb_fetch_failed"));
  }, [showErrorToast, t]);

  const {
    items,
    currentArtworkId,
    isLoading,
    hasMore,
    isStale,
    hasFailed,
    pendingId,
    loadNextPage,
    reload,
    pick,
    clear,
  } = useGameArtworkGrid({
    shop: game.shop,
    objectId: game.objectId,
    assetType,
    enabled: Boolean(userDetails),
    onChanged,
    onError,
  });

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadNextPage();
      },
      { root, rootMargin: SENTINEL_ROOT_MARGIN }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, loadNextPage, items.length]);

  if (!userDetails) {
    return (
      <div className="game-artwork__hint">
        {t("steamgriddb_sign_in_required")}
      </div>
    );
  }

  const showReload = isStale || hasFailed;

  return (
    <div className="game-artwork">
      <div className="game-artwork__header">
        <span className="game-artwork__title">
          {t("steamgriddb_section_title")}
        </span>

        <div className="game-artwork__actions">
          {showReload && (
            <Button type="button" theme="outline" onClick={reload}>
              {t("steamgriddb_refresh")}
            </Button>
          )}

          <Button
            type="button"
            theme="outline"
            onClick={clear}
            disabled={isLoading}
          >
            {t("steamgriddb_use_default")}
          </Button>
        </div>
      </div>

      {isStale && (
        <span className="game-artwork__hint">
          {t("steamgriddb_stale_cache")}
        </span>
      )}

      <SkeletonTheme baseColor="#1c1c1c" highlightColor="#444">
        <div className="game-artwork__scroll" ref={scrollRef}>
          <div
            className={`game-artwork__grid game-artwork__grid--${assetType}`}
          >
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`game-artwork__item game-artwork__item--${assetType} ${
                  currentArtworkId === item.id
                    ? "game-artwork__item--active"
                    : ""
                }`}
                onClick={() => pick(item)}
              >
                <img src={item.thumb} alt="" loading="lazy" />
                {pendingId === item.id && (
                  <span
                    className="game-artwork__item-spinner"
                    aria-hidden="true"
                  />
                )}
              </button>
            ))}

            {isLoading &&
              Array.from({
                length: items.length
                  ? MORE_SKELETON_COUNT
                  : INITIAL_SKELETON_COUNT[assetType],
              }).map((_, index) => (
                <div
                  key={`skeleton-${index}`}
                  className={`game-artwork__item game-artwork__item--${assetType}`}
                >
                  <Skeleton
                    containerClassName="game-artwork__skeleton"
                    height="100%"
                    width="100%"
                  />
                </div>
              ))}
          </div>

          <div ref={sentinelRef} className="game-artwork__sentinel" />

          {!isLoading && !items.length && (
            <span className="game-artwork__hint">
              {t("steamgriddb_no_results")}
            </span>
          )}
        </div>
      </SkeletonTheme>
    </div>
  );
}
