import { useEffect, useState } from "react";
import Skeleton from "react-loading-skeleton";
import cn from "classnames";

const MAX_PRELOADED_ICONS = 300;

const preloadedIcons = new Map<string, HTMLImageElement>();

const preloadAchievementIcon = (src: string) => {
  if (!src || preloadedIcons.has(src)) return;

  const image = new Image();
  image.decoding = "async";
  image.src = src;
  preloadedIcons.set(src, image);

  if (preloadedIcons.size > MAX_PRELOADED_ICONS) {
    const oldest = preloadedIcons.keys().next().value;
    if (oldest !== undefined) preloadedIcons.delete(oldest);
  }
};

const isIconPreloaded = (src: string) => {
  const image = preloadedIcons.get(src);
  return Boolean(image?.complete && image.naturalWidth > 0);
};

export function AchievementIconPreload({ src }: Readonly<{ src: string }>) {
  useEffect(() => {
    preloadAchievementIcon(src);
  }, [src]);

  return null;
}

interface AchievementIconProps {
  src: string;
  alt: string;
  locked: boolean;
}

export function AchievementIcon({
  src,
  alt,
  locked,
}: Readonly<AchievementIconProps>) {
  const [settledSrc, setSettledSrc] = useState<string | null>(() =>
    isIconPreloaded(src) ? src : null
  );
  const isSettled = settledSrc === src;

  const settle = () => setSettledSrc(src);

  return (
    <>
      <img
        ref={(image) => {
          if (image?.complete && image.naturalWidth > 0) settle();
        }}
        className={cn("achievements__item-image", {
          "achievements__item-image--locked": locked,
          "achievements__item-image--loaded": isSettled,
        })}
        src={src}
        alt={alt}
        loading={isSettled ? "eager" : "lazy"}
        decoding="async"
        onLoad={settle}
        onError={settle}
      />
      {!isSettled && (
        <Skeleton
          containerClassName="achievements__item-image-skeleton"
          height="100%"
          width="100%"
        />
      )}
    </>
  );
}
