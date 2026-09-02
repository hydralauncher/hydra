import { useEffect, useState } from "react";

export interface ProcessedImageSize {
  width: number;
  height: number;
}

const processedImageCache = new Map<string, string>();
const inFlightRequests = new Map<string, Promise<string>>();

const getCacheKey = (imageUrl: string, size: ProcessedImageSize) =>
  `${size.width}x${size.height}:${imageUrl}`;

const isRemoteImageUrl = (imageUrl: string) =>
  imageUrl.startsWith("http://") || imageUrl.startsWith("https://");

const requestProcessedImage = (imageUrl: string, size: ProcessedImageSize) => {
  const cacheKey = getCacheKey(imageUrl, size);

  const cached = processedImageCache.get(cacheKey);
  if (cached) return Promise.resolve(cached);

  const inFlight = inFlightRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = window.electron
    .getProcessedImage(imageUrl, {
      width: size.width,
      height: size.height,
      preserveAnimation: true,
    })
    .catch(() => imageUrl)
    .then((processedImageUrl) => {
      const resolved = processedImageUrl ?? imageUrl;
      processedImageCache.set(cacheKey, resolved);
      inFlightRequests.delete(cacheKey);
      return resolved;
    });

  inFlightRequests.set(cacheKey, request);
  return request;
};

export function useProcessedImage(
  imageUrl: string | null | undefined,
  size: ProcessedImageSize
) {
  const { width, height } = size;

  const [processedImageUrl, setProcessedImageUrl] = useState<string | null>(
    () =>
      imageUrl
        ? (processedImageCache.get(getCacheKey(imageUrl, size)) ?? imageUrl)
        : null
  );

  useEffect(() => {
    if (!imageUrl) {
      setProcessedImageUrl(null);
      return;
    }

    if (
      !isRemoteImageUrl(imageUrl) ||
      typeof window.electron?.getProcessedImage !== "function"
    ) {
      setProcessedImageUrl(imageUrl);
      return;
    }

    let cancelled = false;

    setProcessedImageUrl(
      processedImageCache.get(getCacheKey(imageUrl, { width, height })) ??
        imageUrl
    );

    requestProcessedImage(imageUrl, { width, height }).then((resolved) => {
      if (cancelled) return;
      setProcessedImageUrl(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, width, height]);

  return processedImageUrl;
}
