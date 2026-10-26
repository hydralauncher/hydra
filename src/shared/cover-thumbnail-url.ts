export const COVER_THUMBNAIL_SCHEME = "cover-thumb";

export const COVER_THUMBNAIL_WIDTHS = [240, 360, 480, 720, 1080, 1600] as const;

export type CoverThumbnailWidth = (typeof COVER_THUMBNAIL_WIDTHS)[number];

export const pickCoverThumbnailWidth = (pixels: number): CoverThumbnailWidth =>
  COVER_THUMBNAIL_WIDTHS.find((width) => width >= pixels) ??
  COVER_THUMBNAIL_WIDTHS[COVER_THUMBNAIL_WIDTHS.length - 1];

export const isCoverThumbnailSource = (source: string) =>
  /^https?:\/\//i.test(source) || source.startsWith("local:");

export const buildCoverThumbnailUrl = (source: string, width: number) => {
  if (!isCoverThumbnailSource(source)) return source;

  return `${COVER_THUMBNAIL_SCHEME}:?w=${pickCoverThumbnailWidth(width)}&src=${encodeURIComponent(source)}`;
};

export const parseCoverThumbnailUrl = (
  requestUrl: string
): { source: string; width: CoverThumbnailWidth } | null => {
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== `${COVER_THUMBNAIL_SCHEME}:`) return null;

  const source = parsed.searchParams.get("src");
  const width = Number(parsed.searchParams.get("w"));

  if (!source || !isCoverThumbnailSource(source)) return null;
  if (!COVER_THUMBNAIL_WIDTHS.includes(width as CoverThumbnailWidth)) {
    return null;
  }

  return { source, width: width as CoverThumbnailWidth };
};
