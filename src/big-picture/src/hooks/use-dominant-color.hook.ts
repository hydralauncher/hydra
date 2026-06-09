import { getDominantColorFromImage } from "../helpers";
import { useEffect, useState } from "react";

const dominantColorCache = new Map<string, string | null>();

export function useDominantColor(imageUrl: string | null) {
  const [dominantColor, setDominantColor] = useState<string | null>(() => {
    if (!imageUrl) return null;
    return dominantColorCache.get(imageUrl) ?? null;
  });

  useEffect(() => {
    if (!imageUrl) {
      setDominantColor(null);
      return;
    }

    if (dominantColorCache.has(imageUrl)) {
      setDominantColor(dominantColorCache.get(imageUrl) ?? null);
      return;
    }

    let isMounted = true;

    getDominantColorFromImage(imageUrl).then((nextColor) => {
      dominantColorCache.set(imageUrl, nextColor);

      if (!isMounted) return;

      setDominantColor(nextColor);
    });

    return () => {
      isMounted = false;
    };
  }, [imageUrl]);

  return dominantColor;
}
