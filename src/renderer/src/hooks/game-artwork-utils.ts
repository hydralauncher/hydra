interface ArtworkSource {
  url: string;
  thumb: string;
}

interface ArtworkId {
  id: number;
}

export const isVideoArtworkUrl = (url: string | null | undefined) =>
  !!url && /\.(webm|mp4)(\?.*)?$/i.test(url);

export const isAnimatedArtworkItem = (
  item: Pick<ArtworkSource, "url" | "thumb">
) => isVideoArtworkUrl(item.url) || isVideoArtworkUrl(item.thumb);

export const getLastArtworkRowIds = (
  items: readonly ArtworkId[],
  columnsCount: number
): number[] => {
  if (!items.length || columnsCount < 1) return [];

  const lastRowStart =
    Math.floor((items.length - 1) / columnsCount) * columnsCount;

  return items.slice(lastRowStart).map((item) => item.id);
};

export const isArtworkRowSettled = (
  artworkIds: readonly number[],
  settledArtworkIds: ReadonlySet<number>
) =>
  artworkIds.length > 0 &&
  artworkIds.every((artworkId) => settledArtworkIds.has(artworkId));
