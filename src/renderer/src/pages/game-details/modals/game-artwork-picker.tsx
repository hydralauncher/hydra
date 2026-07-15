import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import Skeleton, { SkeletonTheme } from "react-loading-skeleton";

import { Button } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import type {
  ArtworkAssetType,
  ArtworkItem,
  ArtworkKind,
  GameArtworkSelection,
  LibraryGame,
} from "@types";

import "./game-artwork-picker.scss";

const ARTWORK_KIND_BY_TYPE: Record<ArtworkAssetType, ArtworkKind> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

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

  const [items, setItems] = useState<ArtworkItem[]>([]);
  const [selection, setSelection] = useState<GameArtworkSelection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadSelection = useCallback(async () => {
    const record = await window.electron.getGameArtworkSelection(
      game.shop,
      game.objectId
    );
    setSelection(record);
  }, [game.shop, game.objectId]);

  const loadPage = useCallback(
    async (page: number) => {
      if (loadingRef.current) return;

      const requestId = requestIdRef.current;
      loadingRef.current = true;
      setIsLoading(true);

      try {
        const result = await window.electron.getGameArtwork(
          game.shop,
          game.objectId,
          ARTWORK_KIND_BY_TYPE[assetType],
          page
        );

        if (requestId !== requestIdRef.current) return;

        if (!result) {
          setHasMore(false);
          return;
        }

        setItems((previous) => {
          const merged = new Map(previous.map((item) => [item.id, item]));
          result.items.forEach((item) => merged.set(item.id, item));
          return Array.from(merged.values());
        });

        setIsStale(result.cache === "stale");
        setHasMore(result.hasMore);
        setHasFailed(false);
        pageRef.current = page + 1;
      } catch {
        if (requestId !== requestIdRef.current) return;

        setHasFailed(true);
        setHasMore(false);
        showErrorToast(t("steamgriddb_fetch_failed"));
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [game.shop, game.objectId, assetType, showErrorToast, t]
  );

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    loadingRef.current = false;
    pageRef.current = 0;
    setItems([]);
    setHasMore(true);
    setIsStale(false);
    setHasFailed(false);
    setIsLoading(true);
  }, []);

  useEffect(() => {
    loadSelection().catch(() => {});
  }, [loadSelection]);

  useLayoutEffect(() => {
    reset();
  }, [game.shop, game.objectId, assetType, reset]);

  useEffect(() => {
    if (!userDetails) return;

    loadPage(0).catch(() => {});
  }, [userDetails, loadPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) {
          loadPage(pageRef.current).catch(() => {});
        }
      },
      { root, rootMargin: SENTINEL_ROOT_MARGIN }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, loadPage, items.length]);

  const handlePick = async (item: ArtworkItem) => {
    try {
      await window.electron.setGameArtworkSelection({
        shop: game.shop,
        objectId: game.objectId,
        type: assetType,
        url: item.url,
        artworkId: item.id,
      });
      await loadSelection();
      await onChanged();
    } catch {
      showErrorToast(t("steamgriddb_fetch_failed"));
    }
  };

  const handleClear = async () => {
    try {
      await window.electron.setGameArtworkSelection({
        shop: game.shop,
        objectId: game.objectId,
        type: assetType,
        clear: true,
      });
      await loadSelection();
      await onChanged();
    } catch {
      showErrorToast(t("steamgriddb_fetch_failed"));
    }
  };

  const handleReload = () => {
    reset();
    loadPage(0).catch(() => {});
  };

  if (!userDetails) {
    return (
      <div className="game-artwork__hint">
        {t("steamgriddb_sign_in_required")}
      </div>
    );
  }

  const currentArtworkId = selection?.selected?.[assetType]?.artworkId;
  const showReload = isStale || hasFailed;

  return (
    <div className="game-artwork">
      <div className="game-artwork__header">
        <span className="game-artwork__title">
          {t("steamgriddb_section_title")}
        </span>

        <div className="game-artwork__actions">
          {showReload && (
            <Button type="button" theme="outline" onClick={handleReload}>
              {t("steamgriddb_refresh")}
            </Button>
          )}

          <Button
            type="button"
            theme="outline"
            onClick={handleClear}
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
                onClick={() => handlePick(item)}
              >
                <img src={item.thumb} alt="" loading="lazy" />
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
