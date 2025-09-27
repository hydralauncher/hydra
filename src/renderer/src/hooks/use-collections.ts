import { useCallback } from "react";
import { useSelector, useDispatch } from "react-redux";

import type { RootState } from "@renderer/store";
import {
  setCollections,
  addCollection,
  updateCollection as updateCollectionAction,
  removeCollection,
} from "@renderer/features";

export function useCollections() {
  const dispatch = useDispatch();

  const collections = useSelector(
    (state: RootState) => state.collections.value
  );

  const getCollections = useCallback(async () => {
    try {
      const collectionsResult = await window.electron.getCollections();
      dispatch(setCollections(collectionsResult));
    } catch (error) {
      console.error("Error fetching collections:", error);
    }
  }, [dispatch]);

  const createCollection = useCallback(
    async (name: string) => {
      const collection = await window.electron.createCollection(name);
      dispatch(addCollection(collection));
      return collection;
    },
    [dispatch]
  );

  const updateCollection = useCallback(
    async (
      collectionId: string,
      updates: { name?: string; gameIds?: string[] }
    ) => {
      const updatedCollection = await window.electron.updateCollection(
        collectionId,
        updates
      );
      dispatch(updateCollectionAction(updatedCollection));
      return updatedCollection;
    },
    [dispatch]
  );

  const deleteCollection = useCallback(
    async (collectionId: string) => {
      await window.electron.deleteCollection(collectionId);
      dispatch(removeCollection(collectionId));
    },
    [dispatch]
  );

  const addGameToCollection = useCallback(
    async (collectionId: string, gameId: string) => {
      // Parse gameId to get shop and objectId
      const [shop, objectId] = gameId.split(":") as [string, string];
      await window.electron.addGameToCollection(
        collectionId,
        shop as any,
        objectId
      );

      // Refresh collections to get updated data
      await getCollections();
    },
    [getCollections]
  );

  const removeGameFromCollection = useCallback(
    async (collectionId: string, gameId: string) => {
      // Parse gameId to get shop and objectId
      const [shop, objectId] = gameId.split(":") as [string, string];
      await window.electron.removeGameFromCollection(
        collectionId,
        shop as any,
        objectId
      );

      // Refresh collections to get updated data
      await getCollections();
    },
    [getCollections]
  );

  return {
    collections,
    getCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    addGameToCollection,
    removeGameFromCollection,
  };
}
