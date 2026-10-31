import { useEffect, useState } from "react";
import type { GameShop } from "@types";

interface SourceArchiveTarget {
  shop: GameShop;
  objectId: string;
}

export function useSourceArchive(
  target: SourceArchiveTarget | null | undefined,
  enabled: boolean
) {
  const [hasSourceArchive, setHasSourceArchive] = useState(false);
  const shop = target?.shop;
  const objectId = target?.objectId;

  useEffect(() => {
    const electron = globalThis.window?.electron;
    setHasSourceArchive(false);

    if (!enabled || !shop || !objectId || !electron) return;

    let cancelled = false;

    void electron
      .hasSourceArchive(shop, objectId)
      .catch(() => false)
      .then((exists) => {
        if (!cancelled) setHasSourceArchive(exists);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, shop, objectId]);

  return hasSourceArchive;
}
