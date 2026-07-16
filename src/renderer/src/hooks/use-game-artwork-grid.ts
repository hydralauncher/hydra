import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ArtworkAssetType,
  ArtworkItem,
  ArtworkKind,
  GameArtworkSelection,
  GameShop,
} from "@types";

const ARTWORK_KIND_BY_TYPE: Record<ArtworkAssetType, ArtworkKind> = {
  grid: "grids",
  hero: "heroes",
  logo: "logos",
  icon: "icons",
};

export const isVideoArtworkThumb = (thumb: string | null | undefined) =>
  !!thumb && /\.(webm|mp4)(\?.*)?$/i.test(thumb);

export const getArtworkDisplaySource = (
  item: Pick<ArtworkItem, "url" | "thumb">
) => {
  const src = isVideoArtworkThumb(item.thumb) ? item.url : item.thumb;
  return { src, isVideo: isVideoArtworkThumb(src) };
};

const isIcoUrl = (url: string | null | undefined) =>
  !!url && /\.ico(\?.*)?$/i.test(url);

export const getRenderableArtworkUrl = (
  item: ArtworkItem,
  assetType: ArtworkAssetType
) => {
  if (
    assetType === "icon" &&
    isIcoUrl(item.url) &&
    item.thumb &&
    !isVideoArtworkThumb(item.thumb)
  ) {
    return item.thumb;
  }

  return item.url;
};

const preloadImage = (url: string) =>
  new Promise<void>((resolve) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = url;
  });

interface UseGameArtworkGridOptions {
  shop: GameShop;
  objectId: string;
  assetType: ArtworkAssetType;
  enabled: boolean;
  currentArtworkUrl?: string | null;
  onChanged: () => Promise<void> | void;
  onError: () => void;
  onPicked?: () => void;
  onCleared?: () => void;
}

export function useGameArtworkGrid({
  shop,
  objectId,
  assetType,
  enabled,
  currentArtworkUrl,
  onChanged,
  onError,
  onPicked,
  onCleared,
}: UseGameArtworkGridOptions) {
  const [items, setItems] = useState<ArtworkItem[]>([]);
  const [selection, setSelection] = useState<GameArtworkSelection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [hasFailed, setHasFailed] = useState(false);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [isMutating, setIsMutating] = useState(false);

  const pageRef = useRef(0);
  const loadingRef = useRef(false);
  const requestIdRef = useRef(0);
  const mutatingRef = useRef(false);

  const loadSelection = useCallback(async () => {
    const record = await globalThis.window.electron.getGameArtworkSelection(
      shop,
      objectId
    );
    setSelection(record);
  }, [shop, objectId]);

  const loadPage = useCallback(
    async (page: number) => {
      if (loadingRef.current) return;

      const requestId = requestIdRef.current;
      loadingRef.current = true;
      setIsLoading(true);

      try {
        const result = await globalThis.window.electron.getGameArtwork(
          shop,
          objectId,
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
        onError();
      } finally {
        if (requestId === requestIdRef.current) {
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [shop, objectId, assetType, onError]
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
  }, [shop, objectId, assetType, reset]);

  useEffect(() => {
    if (!enabled) return;

    loadPage(0).catch(() => {});
  }, [enabled, loadPage]);

  const loadNextPage = useCallback(() => {
    loadPage(pageRef.current).catch(() => {});
  }, [loadPage]);

  const reload = useCallback(() => {
    reset();
    loadPage(0).catch(() => {});
  }, [reset, loadPage]);

  const pick = useCallback(
    async (item: ArtworkItem) => {
      if (mutatingRef.current) return;

      mutatingRef.current = true;
      setIsMutating(true);
      setPendingId(item.id);
      const renderableUrl = getRenderableArtworkUrl(item, assetType);
      try {
        await globalThis.window.electron.setGameArtworkSelection({
          shop,
          objectId,
          type: assetType,
          url: renderableUrl,
          artworkId: item.id,
        });
        await loadSelection();
        await onChanged();
        await preloadImage(renderableUrl);
        onPicked?.();
      } catch {
        onError();
      } finally {
        setPendingId(null);
        setIsMutating(false);
        mutatingRef.current = false;
      }
    },
    [shop, objectId, assetType, loadSelection, onChanged, onError, onPicked]
  );

  const clear = useCallback(async () => {
    if (mutatingRef.current) return;

    mutatingRef.current = true;
    setIsMutating(true);
    try {
      await globalThis.window.electron.setGameArtworkSelection({
        shop,
        objectId,
        type: assetType,
        clear: true,
      });
      await loadSelection();
      await onChanged();
      onCleared?.();
    } catch {
      onError();
    } finally {
      setIsMutating(false);
      mutatingRef.current = false;
    }
  }, [shop, objectId, assetType, loadSelection, onChanged, onError, onCleared]);

  const normalizeUrl = (value: string | null | undefined) => {
    if (!value) return null;

    try {
      const url = new URL(value);
      return `${url.origin}${url.pathname}`;
    } catch {
      return value;
    }
  };

  const selectedArtworkId = selection?.selected?.[assetType]?.artworkId;
  const normalizedCurrentArtworkUrl = normalizeUrl(currentArtworkUrl);
  const currentArtworkId =
    selectedArtworkId ??
    items.find(
      (item) =>
        normalizeUrl(getRenderableArtworkUrl(item, assetType)) ===
        normalizedCurrentArtworkUrl
    )?.id;

  return {
    items,
    currentArtworkId,
    isLoading,
    hasMore,
    isStale,
    hasFailed,
    pendingId,
    isMutating,
    loadNextPage,
    reloadSelection: loadSelection,
    reload,
    pick,
    clear,
  };
}
