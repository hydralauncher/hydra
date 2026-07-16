interface ArtworkSource {
  url: string;
  thumb: string;
}

export const isVideoArtworkUrl = (url: string | null | undefined) =>
  !!url && /\.(webm|mp4)(\?.*)?$/i.test(url);

export const isAnimatedArtworkItem = (
  item: Pick<ArtworkSource, "url" | "thumb">
) => isVideoArtworkUrl(item.url) || isVideoArtworkUrl(item.thumb);
