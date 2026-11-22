import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop, ShopAssets } from "@types";
import { isInLibrary, withoutLibraryGames } from "@shared";
import {
  removePlayLaterEntry,
  setPlayLater,
  upsertPlayLaterEntry,
} from "@renderer/features";
import { logger } from "@renderer/logger";
import { useAppDispatch, useAppSelector } from "./redux";
import { useToast } from "./use-toast";

export function usePlayLater() {
  const { t } = useTranslation("play_later");
  const dispatch = useAppDispatch();
  const { showErrorToast } = useToast();
  const storedItems = useAppSelector((state) => state.playLater.items);
  // The full library, hidden games included, as the main process sees it.
  const library = useAppSelector((state) => state.library.downloadLibrary);
  const hasLoaded = useAppSelector(
    (state) => state.playLater.hasLoaded && state.library.hasLoaded
  );

  // A game added to the library leaves the list right away; the stored entry
  // is deleted on the next getPlayLater().
  const items = useMemo(
    () => withoutLibraryGames(Object.values(storedItems), library),
    [storedItems, library]
  );
  const hasLibraryGames = items.length < Object.keys(storedItems).length;

  const loadPlayLater = useCallback(async () => {
    try {
      dispatch(setPlayLater(await window.electron.getPlayLater()));
    } catch (error) {
      logger.error("Failed to load Play later", error);
      showErrorToast(t("load_failed"));
    }
  }, [dispatch, showErrorToast, t]);

  const addToPlayLater = useCallback(
    async (assets: ShopAssets) => {
      try {
        const entry = await window.electron.addGameToPlayLater(assets);
        if (entry) dispatch(upsertPlayLaterEntry(entry));
      } catch (error) {
        logger.error("Failed to add game to Play later", error);
        showErrorToast(t("update_failed"));
      }
    },
    [dispatch, showErrorToast, t]
  );

  const removeFromPlayLater = useCallback(
    async (shop: GameShop, objectId: string) => {
      try {
        await window.electron.removeGameFromPlayLater(shop, objectId);
        dispatch(removePlayLaterEntry({ shop, objectId }));
      } catch (error) {
        logger.error("Failed to remove game from Play later", error);
        showErrorToast(t("update_failed"));
      }
    },
    [dispatch, showErrorToast, t]
  );

  const isInPlayLater = useCallback(
    (shop: GameShop, objectId: string) =>
      items.some((item) => item.shop === shop && item.objectId === objectId),
    [items]
  );

  const isLibraryGame = useCallback(
    (shop: GameShop, objectId: string) =>
      isInLibrary({ shop, objectId }, library),
    [library]
  );

  return {
    items,
    hasLoaded,
    hasLibraryGames,
    isLibraryGame,
    loadPlayLater,
    addToPlayLater,
    removeFromPlayLater,
    isInPlayLater,
  };
}
