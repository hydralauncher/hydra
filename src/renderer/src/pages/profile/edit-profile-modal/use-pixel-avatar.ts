import { useCallback, useEffect, useState } from "react";

// Same size the crop modal gives uploaded photos.
const PIXEL_AVATAR_SIZE = 512;

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

/**
 * The API's procedural pixel avatar (`GET /avatars`) for `seed`. It is shown
 * as an SVG and turned into a PNG only on Save, since uploads accept no SVG.
 */
export function usePixelAvatar(seed: string | null) {
  const [pixelAvatarUrl, setPixelAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!seed) return;

    let isCancelled = false;
    window.electron.hydraApi
      .get<string>("/avatars", {
        params: { seed, size: PIXEL_AVATAR_SIZE },
        needsAuth: false,
      })
      .then((svg) => {
        if (isCancelled) return;
        setPixelAvatarUrl(
          `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
        );
      })
      .catch(() => {
        if (!isCancelled) setPixelAvatarUrl(null);
      });

    return () => {
      isCancelled = true;
    };
  }, [seed]);

  /** Renders the avatar to a PNG temp file and returns its path. */
  const savePixelAvatar = useCallback(async () => {
    if (!pixelAvatarUrl) throw new Error("Pixel avatar not loaded");

    const image = await loadImage(pixelAvatarUrl);
    const canvas = document.createElement("canvas");
    canvas.width = PIXEL_AVATAR_SIZE;
    canvas.height = PIXEL_AVATAR_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable");

    context.imageSmoothingEnabled = false;
    context.drawImage(image, 0, 0, PIXEL_AVATAR_SIZE, PIXEL_AVATAR_SIZE);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png")
    );
    if (!blob) throw new Error("PNG export failed");

    const bytes = new Uint8Array(await blob.arrayBuffer());
    return window.electron.saveTempFile("pixel-avatar.png", bytes);
  }, [pixelAvatarUrl]);

  return { pixelAvatarUrl, savePixelAvatar };
}
