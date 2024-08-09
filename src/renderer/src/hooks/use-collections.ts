import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "./redux";
import { setCollections } from "@renderer/features";
import { Collection, Game } from "@types";
import { useToast } from "./use-toast";
import { useTranslation } from "react-i18next";

export function useCollections() {
  const { t } = useTranslation("collections");

  const dispatch = useAppDispatch();
  const collections = useAppSelector((state) => state.collections.value);
  const { showSuccessToast, showErrorToast } = useToast();

  const updateCollections = useCallback(async () => {
    return window.electron
      .getCollections()
      .then((updatedCollection) => dispatch(setCollections(updatedCollection)));
  }, [dispatch]);

  const addCollection = async (title: string) => {
    if (
      !collections.some((collection) => collection.title === title) &&
      title !== ""
    ) {
      await window.electron.addCollection(title);

      updateCollections();
      showSuccessToast(t("the_collection_has_been_added_successfully"));
    } else {
      showErrorToast(t("you_cant_give_collections_existing_or_empty_names"));
    }
  };

  const removeCollection = async (collection: Collection) => {
    await window.electron.removeCollection(collection);

    updateCollections();
    showSuccessToast(t("the_collection_has_been_removed_successfully"));
  };

  const addCollectionGame = async (collectionId: number, game: Game) => {
    await window.electron.addCollectionGame(collectionId, game);

    updateCollections();
    showSuccessToast(t("the_game_has_been_added_to_the_collection"));
  };

  const removeCollectionGame = async (collectionId: number, game: Game) => {
    await window.electron.removeCollectionGame(collectionId, game);

    updateCollections();
    showSuccessToast(t("the_game_has_been_removed_from_the_collection"));
  };

  return {
    collections,
    updateCollections,
    addCollection,
    removeCollection,
    addCollectionGame,
    removeCollectionGame,
  };
}
