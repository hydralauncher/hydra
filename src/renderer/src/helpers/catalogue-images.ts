import { thumbHashToDataURL } from "thumbhash";
import type { CatalogueImages, CatalogueImageVariants } from "@types";

const MAX_CACHED_PLACEHOLDERS = 1000;
const placeholderCache = new Map<string, string | null>();

export const findCatalogueImageVariants = (
  images: CatalogueImages | null | undefined,
  url: string | null | undefined
): CatalogueImageVariants | null => {
  const variants = url ? images?.[url.trim()] : undefined;
  return variants?.base && variants.widths.length > 0 ? variants : null;
};

const sortedWidths = (variants: CatalogueImageVariants) =>
  [...variants.widths].sort((a, b) => a - b);

export const getCatalogueImageUrl = (
  variants: CatalogueImageVariants,
  width: number
) => `${variants.base}/w${width}.webp`;

export const pickCatalogueImageUrl = (
  variants: CatalogueImageVariants,
  targetWidth: number
) => {
  const widths = sortedWidths(variants);
  const width =
    widths.find((candidate) => candidate >= targetWidth) ?? widths.at(-1)!;
  return getCatalogueImageUrl(variants, width);
};

export const getCatalogueImageSrcSet = (variants: CatalogueImageVariants) =>
  sortedWidths(variants)
    .map((width) => `${getCatalogueImageUrl(variants, width)} ${width}w`)
    .join(", ");

export const getCatalogueImageDensitySrcSet = (
  variants: CatalogueImageVariants,
  displayWidth: number
) =>
  [1, 2]
    .map(
      (density) =>
        `${pickCatalogueImageUrl(variants, displayWidth * density)} ${density}x`
    )
    .join(", ");

export const decodeCatalogueThumbHash = (
  thumbHash: string | null | undefined
): string | null => {
  if (!thumbHash) return null;

  const cached = placeholderCache.get(thumbHash);
  if (cached !== undefined) return cached;

  let placeholder: string | null = null;
  try {
    const bytes = Uint8Array.from(atob(thumbHash), (char) =>
      char.charCodeAt(0)
    );
    placeholder = thumbHashToDataURL(bytes);
  } catch {
    placeholder = null;
  }

  if (placeholderCache.size >= MAX_CACHED_PLACEHOLDERS) {
    const oldest = placeholderCache.keys().next().value;
    if (oldest !== undefined) placeholderCache.delete(oldest);
  }
  placeholderCache.set(thumbHash, placeholder);
  return placeholder;
};
