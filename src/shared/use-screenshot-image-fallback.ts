import { useCallback, useState } from "react";

export function useScreenshotImageFallback(
  imageUrl: string | null,
  refreshImage?: () => Promise<void>
) {
  const [failedImageUrl, setFailedImageUrl] = useState<string | null>(null);
  const [refreshingImageUrl, setRefreshingImageUrl] = useState<string | null>(
    null
  );
  const isRefreshing = imageUrl !== null && imageUrl === refreshingImageUrl;
  const hasImage = Boolean(
    imageUrl && imageUrl !== failedImageUrl && !isRefreshing
  );

  const handleImageError = useCallback(async () => {
    if (!imageUrl) return;
    if (!refreshImage) {
      setFailedImageUrl(imageUrl);
      return;
    }

    setRefreshingImageUrl(imageUrl);
    try {
      await refreshImage();
    } finally {
      setFailedImageUrl(imageUrl);
      setRefreshingImageUrl(null);
    }
  }, [imageUrl, refreshImage]);

  return { hasImage, isRefreshing, handleImageError };
}
