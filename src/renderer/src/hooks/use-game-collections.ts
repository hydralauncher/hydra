import { useCallback, useRef } from "react";
import type { GameCollection, LibraryGame } from "@types";
import { useAppDispatch, useAppSelector } from "./redux";
import {
  addCollection,
  applyCollectionAssignment,
  setCollections,
  setCollectionsLoadFailed,
  setCollectionsLoading,
  setGameCollectionIds,
} from "@renderer/features";
import { ensureArray } from "@renderer/helpers";
import {
  findLibraryGamePresentation,
  applyLibraryGroupAction,
  getLibraryCollectionIds as getNormalizedCollectionIds,
} from "@shared";
import { getLibraryGroupCollectionAssignments } from "../../../shared/library-group-actions";
import { useLibrary } from "./use-library";

export function useGameCollections() {
  const dispatch = useAppDispatch();
  const loadCollectionsRequestRef = useRef<Promise<GameCollection[]> | null>(
    null
  );
  const collections = useAppSelector((state) => state.collections.items);
  const isLoading = useAppSelector((state) => state.collections.isLoading);
  const hasLoaded = useAppSelector((state) => state.collections.hasLoaded);
  const hasFailed = useAppSelector((state) => state.collections.hasFailed);
  const library = useAppSelector((state) => state.library.downloadLibrary);
  const { updateLibrary } = useLibrary();

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

        const collections = ensureArray<GameCollection>(
          response,
          "/profile/games/collections"
        );

        dispatch(setCollections(collections));
        return collections;
      } catch (error) {
        void error;
        dispatch(setCollectionsLoadFailed());
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
      collectionIds: string[]
    ) => {
      const group = findLibraryGamePresentation(library, game);
      const members: (Pick<LibraryGame, "shop" | "objectId"> &
        Partial<LibraryGame>)[] = group?.members ?? [
        {
          ...game,
          collectionIds: getNormalizedCollectionIds(
            library.find(
              (item) =>
                item.shop === game.shop && item.objectId === game.objectId
            )
          ),
        },
      ];
      const assignments = getLibraryGroupCollectionAssignments(
        members,
        collectionIds
      );
      try {
        await applyLibraryGroupAction(
          assignments.map(({ game: member }) => member),
          async (member) => {
            const nextCollectionIds = assignments.find(
              ({ game: item }) =>
                item.shop === member.shop && item.objectId === member.objectId
            )!.collectionIds;
            await window.electron.assignGameToCollection(
              member.shop,
              member.objectId,
              nextCollectionIds
            );
            dispatch(
              setGameCollectionIds({
                shop: member.shop,
                objectId: member.objectId,
                collectionIds: nextCollectionIds,
              })
            );
            if (member.shop !== "custom") {
              dispatch(
                applyCollectionAssignment({
                  previousCollectionIds: getNormalizedCollectionIds(member),
                  nextCollectionIds,
                })
              );
            }
          }
        );
      } finally {
        await Promise.all([updateLibrary(), loadCollections()]);
      }
    },
    [dispatch, library, updateLibrary, loadCollections]
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
    hasFailed,
    loadCollections,
    assignGameToCollection,
    createCollection,
  };
}
