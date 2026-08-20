import { ImageIcon } from "@primer/octicons-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { isAnimatedCoverCandidate, useCoverPoster } from "@renderer/hooks";
import { getVerticalCoverCardImageSources } from "./vertical-cover-card-image-sources";

import "./vertical-cover-card.scss";

export interface VerticalCoverCardProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  gameTitle: string;
  coverImageUrls: ReadonlyArray<string | null | undefined>;
  children?: ReactNode;
  useClassicsLayout?: boolean;
  showTitleTooltip?: boolean;
}

export function VerticalCoverCard({
  gameTitle,
  coverImageUrls,
  children,
  useClassicsLayout = false,
  showTitleTooltip = true,
  className,
  onMouseEnter,
  onMouseLeave,
  ...buttonProps
}: Readonly<VerticalCoverCardProps>) {
  const imageSources = getVerticalCoverCardImageSources(coverImageUrls);
  const imageSourcesKey = imageSources.join("\u0000");
  const [imageIndex, setImageIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const failedImageSourcesRef = useRef(new Set<string>());
  const coverImageUrl = imageSources[imageIndex];
  const isAnimatedCover = isAnimatedCoverCandidate(coverImageUrl);
  const coverPoster = useCoverPoster(coverImageUrl, isAnimatedCover);
  const displayCoverUrl =
    (isAnimatedCover && !isHovered && coverPoster
      ? coverPoster
      : coverImageUrl) ?? undefined;

  useEffect(() => {
    failedImageSourcesRef.current.clear();
    setImageIndex(0);
  }, [imageSourcesKey]);

  const handleImageError = () => {
    if (!coverImageUrl || failedImageSourcesRef.current.has(coverImageUrl)) {
      return;
    }

    failedImageSourcesRef.current.add(coverImageUrl);
    setImageIndex((currentIndex) => currentIndex + 1);
  };

  const renderCoverMedia = () => {
    if (!displayCoverUrl) {
      return (
        <div className="vertical-cover-card__placeholder">
          <ImageIcon size={48} />
        </div>
      );
    }

    if (useClassicsLayout) {
      return (
        <div className="vertical-cover-card__classics-cover">
          <img
            src={displayCoverUrl}
            alt=""
            aria-hidden="true"
            className="vertical-cover-card__classics-backdrop"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
          />
          <img
            src={displayCoverUrl}
            alt={gameTitle}
            className="vertical-cover-card__classics-image"
            loading="lazy"
            decoding="async"
            onError={handleImageError}
          />
        </div>
      );
    }

    return (
      <img
        src={displayCoverUrl}
        alt={gameTitle}
        className="vertical-cover-card__image"
        loading="lazy"
        decoding="async"
        onError={handleImageError}
      />
    );
  };

  return (
    <button
      {...buttonProps}
      type="button"
      className={["vertical-cover-card", className].filter(Boolean).join(" ")}
      aria-label={buttonProps["aria-label"] ?? gameTitle}
      title={showTitleTooltip ? (buttonProps.title ?? gameTitle) : undefined}
      onMouseEnter={(event) => {
        setIsHovered(true);
        onMouseEnter?.(event);
      }}
      onMouseLeave={(event) => {
        setIsHovered(false);
        onMouseLeave?.(event);
      }}
    >
      {children}
      {renderCoverMedia()}
    </button>
  );
}
