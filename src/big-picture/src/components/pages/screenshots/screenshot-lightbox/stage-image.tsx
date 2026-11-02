import { EyeIcon, ImageIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useEffect, useMemo, useRef, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import { useScreenshotImageFallback } from "@shared";

import { getScreenshotAltText, type ScreenshotBlurReason } from "../helpers";
import { ProgressiveScreenshotImage } from "../progressive-screenshot-image";

const BLUR_COPY: Record<
  ScreenshotBlurReason,
  { warning: string; reveal: string }
> = {
  sensitive: {
    warning: "screenshots_sensitive_warning",
    reveal: "screenshots_sensitive_reveal",
  },
  spoiler: {
    warning: "screenshots_spoiler_warning",
    reveal: "screenshots_reveal_spoiler",
  },
};

interface ScreenshotStageImageProps {
  screenshot: ProfileScreenshot;
  className: string;
  blurReason: ScreenshotBlurReason | null;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onPreviewReady: (aspectRatio: number) => void;
  onError: () => void;
  onReveal: () => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
}

export function ScreenshotStageImage({
  screenshot,
  className,
  blurReason,
  onLoad,
  onPreviewReady,
  onError,
  onReveal,
  onRefreshImage,
}: Readonly<ScreenshotStageImageProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const refreshImage = useMemo(
    () => (onRefreshImage ? () => onRefreshImage(screenshot) : undefined),
    [onRefreshImage, screenshot]
  );
  const { hasImage, isRefreshing, handleImageError } =
    useScreenshotImageFallback(screenshot.imageUrl, refreshImage);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!hasImage) onErrorRef.current();
  }, [hasImage]);

  const handlePlaceholderLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    const width = screenshot.width || naturalWidth;
    const height = screenshot.height || naturalHeight;
    if (width && height) onPreviewReady(width / height);
  };
  const handleLayerError = (source: string) => {
    if (source === screenshot.imageUrl) void handleImageError();
  };

  if (!hasImage || !screenshot.imageUrl) {
    return (
      <div className="screenshot-viewer__placeholder">
        <ImageIcon size={56} />
        {isRefreshing ? null : (
          <span>{t("screenshots_image_unavailable")}</span>
        )}
      </div>
    );
  }

  return (
    <>
      <ProgressiveScreenshotImage
        className={cn(className, {
          "screenshot-viewer__image--spoiler": blurReason !== null,
        })}
        fit="contain"
        sources={[screenshot.thumbnailUrl ?? "", screenshot.imageUrl]}
        thumbHash={screenshot.thumbHash}
        alt={getScreenshotAltText(screenshot, t, language)}
        onLoad={onLoad}
        onError={handleLayerError}
        onPlaceholderLoad={handlePlaceholderLoad}
      />
      {blurReason ? (
        <div className="screenshot-viewer__spoiler">
          <span>{t(BLUR_COPY[blurReason].warning)}</span>
          <button
            type="button"
            className="screenshot-viewer__reveal"
            tabIndex={-1}
            onClick={onReveal}
          >
            <EyeIcon size={18} />
            {t(BLUR_COPY[blurReason].reveal)}
          </button>
          <span className="screenshot-viewer__reveal-hint">
            {t("screenshots_reveal_spoiler_hint")}
          </span>
        </div>
      ) : null}
    </>
  );
}
