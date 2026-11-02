import { ImageIcon } from "@primer/octicons-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { CatalogueImages } from "@types";

import {
  isAnimatedCoverCandidate,
  useAnimatedSourceWarmup,
  useAppSelector,
  useCatalogueImage,
  useCoverPoster,
} from "@renderer/hooks";
import {
  getCatalogueImageSrcSet,
  pickCatalogueImageUrl,
} from "@renderer/helpers/catalogue-images";
import { getVerticalCoverCardImageSources } from "./vertical-cover-card-image-sources";

import "./vertical-cover-card.scss";

const COVER_DISPLAY_WIDTH = 300;

export interface VerticalCoverCardProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  gameTitle: string;
  coverImageUrls: readonly (string | null | undefined)[];
  catalogueImages?: CatalogueImages;
  children?: ReactNode;
  useClassicsLayout?: boolean;
  showTitleTooltip?: boolean;
}

export function VerticalCoverCard({
  gameTitle,
  coverImageUrls,
  catalogueImages,
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
  const userPreferences = useAppSelector(
    (state) => state.userPreferences.value
  );
  const autoplayAnimatedArtwork =
    userPreferences?.autoplayAnimatedArtwork ?? false;
  const catalogueImage = useCatalogueImage(
    useClassicsLayout ? null : coverImageUrl,
    catalogueImages
  );
  const coverVariants = catalogueImage.variants;
  const isAnimatedCover =
    !coverVariants && isAnimatedCoverCandidate(coverImageUrl);
  const coverPoster = useCoverPoster(coverImageUrl, isAnimatedCover);
  const shouldHoldFrame =
    isAnimatedCover && !isHovered && !autoplayAnimatedArtwork;
  const isAwaitingPoster = shouldHoldFrame && coverPoster === undefined;

  useAnimatedSourceWarmup(
    coverImageUrl,
    isAnimatedCover && !autoplayAnimatedArtwork && Boolean(coverPoster)
  );
  const displayCoverUrl =
    (shouldHoldFrame && coverPoster ? coverPoster : coverImageUrl) ?? undefined;

  useEffect(() => {
    failedImageSourcesRef.current.clear();
    setImageIndex(0);
  }, [imageSourcesKey]);

  const handleImageError = () => {
    if (catalogueImage.markFailed()) return;

    if (!coverImageUrl || failedImageSourcesRef.current.has(coverImageUrl)) {
      return;
    }

    failedImageSourcesRef.current.add(coverImageUrl);
    setImageIndex((currentIndex) => currentIndex + 1);
  };

  const renderCoverMedia = () => {
    if (isAwaitingPoster) {
      return <div className="vertical-cover-card__placeholder" />;
    }

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
        src={
          coverVariants
            ? pickCatalogueImageUrl(coverVariants, COVER_DISPLAY_WIDTH)
            : displayCoverUrl
        }
        srcSet={
          coverVariants ? getCatalogueImageSrcSet(coverVariants) : undefined
        }
        sizes={coverVariants ? `auto, ${COVER_DISPLAY_WIDTH}px` : undefined}
        style={catalogueImage.placeholderStyle}
        alt={gameTitle}
        className="vertical-cover-card__image"
        loading="lazy"
        decoding="async"
        onLoad={catalogueImage.markLoaded}
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
