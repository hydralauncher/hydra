import { useEffect, useState } from "react";

import type { GameShop } from "@types";

// The square icon of a game, the same asset as the launcher's sidebar. It is
// undefined while loading and null when the game has none.
export function useGameIcon(
  shop: string | null | undefined,
  objectId: string | null | undefined
) {
  const key = shop && objectId ? `${shop}:${objectId}` : null;
  const [loaded, setLoaded] = useState<{
    key: string;
    iconUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!key || !shop || !objectId) return;

    let cancelled = false;
    globalThis.window.electron
      .getGameAssets(objectId, shop as GameShop)
      .then((assets) => {
        if (!cancelled) setLoaded({ key, iconUrl: assets?.iconUrl ?? null });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ key, iconUrl: null });
      });

    return () => {
      cancelled = true;
    };
  }, [key, objectId, shop]);

  return loaded?.key === key ? loaded.iconUrl : undefined;
}
