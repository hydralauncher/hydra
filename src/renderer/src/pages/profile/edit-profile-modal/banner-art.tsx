import Skeleton from "react-loading-skeleton";

/**
 * A banner image, or the loading skeleton while `isDeferred`. Large animated
 * banners stall the frame they first paint in, so the Banner tab holds them
 * back until its switch animation is over.
 */
export function BannerArt({
  src,
  isVideo = false,
  isDeferred = false,
}: Readonly<{ src: string; isVideo?: boolean; isDeferred?: boolean }>) {
  if (isDeferred) {
    return (
      <Skeleton
        width="100%"
        height="100%"
        borderRadius={0}
        containerClassName="edit-profile-modal__skeleton-fill"
      />
    );
  }

  if (isVideo) {
    return <video src={src} autoPlay loop muted playsInline />;
  }

  return <img src={src} alt="" decoding="async" />;
}
