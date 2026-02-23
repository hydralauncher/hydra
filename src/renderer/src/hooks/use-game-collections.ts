import { useCallback, useRef } from "react";
import type { GameCollection, LibraryGame } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  addCollection,
  applyCollectionAssignment,
  setCollections,
  setCollectionsLoading,
  setGameCollectionId,
} from "@renderer/features";

export function useGameCollections() {
  const dispatch = useAppDispatch();
  const loadCollectionsRequestRef = useRef<Promise<GameCollection[]> | null>(
    null
  );
  const collections = useAppSelector((state) => state.collections.items);
  const isLoading = useAppSelector((state) => state.collections.isLoading);
  const hasLoaded = useAppSelector((state) => state.collections.hasLoaded);
  const library = useAppSelector((state) => state.library.value);

  const loadCollections = useCallback(async () => {
    if (loadCollectionsRequestRef.current) {
      return loadCollectionsRequestRef.current;
    }

    const request = (async () => {
      dispatch(setCollectionsLoading(true));

      try {
        const response = await window.electron.hydraApi.get<GameCollection[]>(
          "/profile/games/collections",
          { needsAuth: true }
        );

        dispatch(setCollections(response));
        return response;
      } catch (error) {
        void error;
        return [];
      } finally {
        dispatch(setCollectionsLoading(false));
        loadCollectionsRequestRef.current = null;
      }
    })();

    loadCollectionsRequestRef.current = request;

    return request;
  }, [dispatch]);

  const assignGameToCollection = useCallback(
    async (
      game: Pick<LibraryGame, "shop" | "objectId">,
      collectionId: string | null
    ) => {
      const currentGame = library.find(
        (libraryGame) =>
          libraryGame.shop === game.shop &&
          libraryGame.objectId === game.objectId
      );

      const previousCollectionId = currentGame?.collectionId ?? null;

      await window.electron.hydraApi.put(
        `/profile/games/${game.shop}/${game.objectId}/collection`,
        {
          data: { collectionId },
          needsAuth: true,
        }
      );

      dispatch(
        setGameCollectionId({
          shop: game.shop,
          objectId: game.objectId,
          collectionId,
        })
      );

      dispatch(
        applyCollectionAssignment({
          previousCollectionId,
          nextCollectionId: collectionId,
        })
      );
    },
    [dispatch, library]
  );

  const createCollection = useCallback(
    async (name: string) => {
      const normalizedName = name.trim().toLocaleLowerCase();
      const alreadyExists = collections.some(
        (collection) =>
          collection.name.trim().toLocaleLowerCase() === normalizedName
      );

      if (alreadyExists) {
        throw new Error("game/collection-name-already-in-use");
      }

      const response = await window.electron.hydraApi.post<GameCollection>(
        "/profile/games/collections",
        {
          data: { name },
          needsAuth: true,
        }
      );

      dispatch(addCollection(response));

      return response;
    },
    [collections, dispatch]
  );

  return {
    collections,
    isLoading,
    hasLoaded,
    loadCollections,
    assignGameToCollection,
    createCollection,
  };
}
