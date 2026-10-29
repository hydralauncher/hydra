import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import type { CatalogueImages, CatalogueImageVariants } from "@types";
import {
  decodeCatalogueThumbHash,
  findCatalogueImageVariants,
  pickCatalogueImageUrl,
} from "@renderer/helpers/catalogue-images";

const subscribeToResize = (onResize: () => void) => {
  globalThis.window.addEventListener("resize", onResize);
  return () => globalThis.window.removeEventListener("resize", onResize);
};

/**
 * Picks the copy that covers the window's width in device pixels. The
 * component re-renders only when a resize changes the picked copy.
 */
export function useViewportCatalogueImageUrl(
  variants: CatalogueImageVariants | null
) {
  const getSnapshot = useCallback(
    () =>
      variants
        ? pickCatalogueImageUrl(
            variants,
            globalThis.window.innerWidth * globalThis.window.devicePixelRatio
          )
        : null,
    [variants]
  );

  return useSyncExternalStore(subscribeToResize, getSnapshot);
}

/**
 * Resolves the resized CDN copy of an artwork URL. Callers fall back to the
 * original URL once `markFailed` returns true for a broken copy.
 */
export function useCatalogueImage(
  url: string | null | undefined,
  images: CatalogueImages | null | undefined
) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);

  const found = findCatalogueImageVariants(images, url);
  const variants = found && failedUrl !== url ? found : null;
  const isLoaded = Boolean(url) && loadedUrl === url;
  const placeholder = useMemo(
    () => decodeCatalogueThumbHash(variants?.thumbHash),
    [variants?.thumbHash]
  );

  const placeholderStyle = useMemo<CSSProperties | undefined>(
    () =>
      placeholder && !isLoaded
        ? {
            backgroundImage: `url("${placeholder}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }
        : undefined,
    [placeholder, isLoaded]
  );

  const markLoaded = useCallback(() => {
    if (url) setLoadedUrl(url);
  }, [url]);

  const markFailed = useCallback(() => {
    if (!variants || !url) return false;
    setFailedUrl(url);
    return true;
  }, [variants, url]);

  return {
    variants,
    placeholder,
    placeholderStyle,
    isLoaded,
    markLoaded,
    markFailed,
  };
}
