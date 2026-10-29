import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { CatalogueImages } from "@types";
import {
  decodeCatalogueThumbHash,
  findCatalogueImageVariants,
} from "@renderer/helpers/catalogue-images";

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
