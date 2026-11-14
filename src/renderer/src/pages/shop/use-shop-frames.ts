import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  FramePurchaseResponse,
  ShopFrameCollection,
  ShopFramesResponse,
} from "@types";

const updateFrames = (
  collections: ShopFrameCollection[],
  update: (frame: ShopFrameCollection["frames"][number]) => object
) =>
  collections.map((collection) => ({
    ...collection,
    frames: collection.frames.map((frame) => ({ ...frame, ...update(frame) })),
  }));

export function useShopFrames(isEnabled: boolean) {
  const { i18n } = useTranslation();
  const [collections, setCollections] = useState<ShopFrameCollection[] | null>(
    null
  );
  const [hasFailed, setHasFailed] = useState(false);

  const load = useCallback(async () => {
    setHasFailed(false);
    try {
      const response = await window.electron.hydraApi.get<ShopFramesResponse>(
        "/shop/frames",
        {
          params: { locale: i18n.language },
        }
      );
      setCollections(response.collections);
    } catch {
      setHasFailed(true);
    }
  }, [i18n.language]);

  useEffect(() => {
    if (isEnabled) void load();
  }, [isEnabled, load]);

  const purchase = useCallback(async (key: string) => {
    const response = await window.electron.hydraApi.post<FramePurchaseResponse>(
      `/shop/frames/${encodeURIComponent(key)}/purchase`
    );
    setCollections(
      (current) =>
        current &&
        updateFrames(current, (frame) =>
          frame.key === key ? { isOwned: true } : {}
        )
    );
    return response;
  }, []);

  const equip = useCallback(async (key: string | null) => {
    await window.electron.hydraApi.put("/profile/frame", {
      data: { frameKey: key },
    });
    setCollections(
      (current) =>
        current &&
        updateFrames(current, (frame) => ({ isEquipped: frame.key === key }))
    );
  }, []);

  return { collections, hasFailed, reload: load, purchase, equip };
}
