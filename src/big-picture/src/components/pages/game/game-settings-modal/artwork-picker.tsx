import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type {
  ArtworkAssetType,
  ArtworkItem,
  ArtworkKind,
  GameArtworkSelection,
  LibraryGame,
} from "@types";

import { FocusItem, GridFocusGroup } from "../../../common";
import { useBigPictureToast, useUserDetails } from "../../../../hooks";
import type { FocusOverrides } from "../../../../services";
import { useArtworkGridNavigation } from "./use-artwork-grid-navigation";

import "./artwork-picker.scss";

const ARTWORK_KIND_BY_TYPE: Record<ArtworkAssetType, ArtworkKind> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

const ARTWORK_GRID_REGION_ID = "game-artwork-grid";
const ARTWORK_USE_DEFAULT_FOCUS_ID = "game-artwork-use-default";
const SENTINEL_ROOT_MARGIN = "320px 0px";

const USE_DEFAULT_OVERRIDES: FocusOverrides = {
  down: {
    type: "region",
    regionId: ARTWORK_GRID_REGION_ID,
    entryDirection: "down",
  },
};

const INITIAL_SKELETON_COUNT: Record<ArtworkAssetType, number> = {
  icon: 18,
  grid: 8,
  hero: 6,
  logo: 9,
};
const MORE_SKELETON_COUNT = 4;

const getTileFocusId = (id: number) => `game-artwork-tile-${id}`;

const preloadImage = (url: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });

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
  const { showErrorToast } = useBigPictureToast();
  const { userDetails } = useUserDetails();

  const [items, setItems] = useState<ArtworkItem[]>([]);
  const [selection, setSelection] = useState<GameArtworkSelection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);

  const loadSelection = useCallback(async () => {
    const record = await globalThis.window.electron.getGameArtworkSelection(
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
        const result = await globalThis.window.electron.getGameArtwork(
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

        setHasMore(result.hasMore);
        pageRef.current = page + 1;
      } catch {
        if (requestId !== requestIdRef.current) return;

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
    if (!sentinel || !hasMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingRef.current) {
          loadPage(pageRef.current).catch(() => {});
        }
      },
      { rootMargin: SENTINEL_ROOT_MARGIN }
    );

    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [hasMore, loadPage, items.length]);

  const tileFocusIds = items.map((item) => getTileFocusId(item.id));
  const overridesByItemId = useArtworkGridNavigation(
    tileFocusIds,
    ARTWORK_USE_DEFAULT_FOCUS_ID
  );

  const handlePick = useCallback(
    async (item: ArtworkItem) => {
      setPendingId(item.id);
      try {
        await globalThis.window.electron.setGameArtworkSelection({
          shop: game.shop,
          objectId: game.objectId,
          type: assetType,
          url: item.url,
          artworkId: item.id,
        });
        await loadSelection();
        await onChanged();
        await preloadImage(item.url);
      } catch {
        showErrorToast(t("steamgriddb_fetch_failed"));
      } finally {
        setPendingId(null);
      }
    },
    [
      game.shop,
      game.objectId,
      assetType,
      loadSelection,
      onChanged,
      showErrorToast,
      t,
    ]
  );

  const handleClear = useCallback(async () => {
    try {
      await globalThis.window.electron.setGameArtworkSelection({
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
  }, [
    game.shop,
    game.objectId,
    assetType,
    loadSelection,
    onChanged,
    showErrorToast,
    t,
  ]);

  if (!userDetails) {
    return (
      <p className="game-artwork-picker__hint">
        {t("steamgriddb_sign_in_required")}
      </p>
    );
  }

  const currentArtworkId = selection?.selected?.[assetType]?.artworkId;
  const skeletonCount = items.length
    ? MORE_SKELETON_COUNT
    : INITIAL_SKELETON_COUNT[assetType];

  return (
    <div className="game-artwork-picker">
      <div className="game-artwork-picker__header">
        <span className="game-artwork-picker__title">
          {t("steamgriddb_section_title")}
        </span>

        <FocusItem
          id={ARTWORK_USE_DEFAULT_FOCUS_ID}
          actions={{ primary: () => void handleClear() }}
          navigationOverrides={USE_DEFAULT_OVERRIDES}
          asChild
        >
          <button
            type="button"
            className="game-artwork-picker__default-button"
            onClick={() => void handleClear()}
          >
            {t("steamgriddb_use_default")}
          </button>
        </FocusItem>
      </div>

      <GridFocusGroup
        regionId={ARTWORK_GRID_REGION_ID}
        className={`game-artwork-picker__grid game-artwork-picker__grid--${assetType}`}
      >
        {items.map((item) => (
          <FocusItem
            key={item.id}
            id={getTileFocusId(item.id)}
            actions={{ primary: () => void handlePick(item) }}
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
              onClick={() => void handlePick(item)}
            >
              <img src={item.thumb} alt="" loading="lazy" />
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
          ? Array.from({ length: skeletonCount }).map((_, index) => (
              <div
                key={`game-artwork-skeleton-${index}`}
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
