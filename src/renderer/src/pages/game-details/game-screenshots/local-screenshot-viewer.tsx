import { useMemo } from "react";

import { GalleryLightbox } from "../gallery-slider/gallery-lightbox";
import type { GalleryMediaItem } from "../gallery-slider/gallery-slider";
import { toLocalScreenshotUrl, type useLocalScreenshotViewer } from "@shared";
import type { LocalScreenshot } from "@types";

interface LocalScreenshotViewerProps {
  screenshots: LocalScreenshot[];
  viewer: ReturnType<typeof useLocalScreenshotViewer>;
  describe: (screenshot: LocalScreenshot) => string;
}

export function LocalScreenshotViewer({
  screenshots,
  viewer,
  describe,
}: Readonly<LocalScreenshotViewerProps>) {
  const items = useMemo<GalleryMediaItem[]>(
    () =>
      screenshots.map((screenshot) => ({
        id: screenshot.clientId,
        type: "image",
        src: toLocalScreenshotUrl(screenshot.path),
        alt: describe(screenshot),
      })),
    [describe, screenshots]
  );

  return (
    <GalleryLightbox
      visible={viewer.current !== null && viewer.index >= 0}
      items={items}
      index={Math.max(viewer.index, 0)}
      showFilmstrip={false}
      showCounter={false}
      trapFocus
      onClose={viewer.close}
      onNavigate={(index) => {
        const next = screenshots[index];
        if (next) viewer.open(next.clientId);
      }}
    />
  );
}
