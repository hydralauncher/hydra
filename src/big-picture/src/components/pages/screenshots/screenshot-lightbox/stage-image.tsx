import { EyeIcon, ImageIcon } from "@phosphor-icons/react";
import cn from "classnames";
import { useEffect, useMemo, useRef, type SyntheticEvent } from "react";
import { useTranslation } from "react-i18next";
import type { ProfileScreenshot } from "@types";
import { useScreenshotImageFallback } from "@shared";

import { getScreenshotAltText } from "../helpers";

interface ScreenshotStageImageProps {
  screenshot: ProfileScreenshot;
  className: string;
  isBlurred: boolean;
  onLoad: (event: SyntheticEvent<HTMLImageElement>) => void;
  onError: () => void;
  onReveal: () => void;
  onRefreshImage?: (screenshot: ProfileScreenshot) => Promise<void>;
}

export function ScreenshotStageImage({
  screenshot,
  className,
  isBlurred,
  onLoad,
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

  if (!hasImage) {
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
      <img
        className={cn(className, {
          "screenshot-viewer__image--spoiler": isBlurred,
        })}
        src={screenshot.imageUrl ?? undefined}
        alt={getScreenshotAltText(screenshot, t, language)}
        draggable={false}
        onLoad={onLoad}
        onError={() => void handleImageError()}
      />
      {isBlurred ? (
        <div className="screenshot-viewer__spoiler">
          <span>{t("screenshots_spoiler_warning")}</span>
          <button
            type="button"
            className="screenshot-viewer__reveal"
            tabIndex={-1}
            onClick={onReveal}
          >
            <EyeIcon size={18} />
            {t("screenshots_reveal_spoiler")}
          </button>
          <span className="screenshot-viewer__reveal-hint">
            {t("screenshots_reveal_spoiler_hint")}
          </span>
        </div>
      ) : null}
    </>
  );
}
