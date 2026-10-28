import { useState } from "react";
import Skeleton from "react-loading-skeleton";
import cn from "classnames";

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
  const [settledSrc, setSettledSrc] = useState<string | null>(null);
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
        loading="lazy"
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
