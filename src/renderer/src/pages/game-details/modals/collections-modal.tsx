import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button, Modal, TextField } from "@renderer/components";
import type { Collection, Game } from "@types";
import * as styles from "./collections-modal.css";
import { useCollections } from "@renderer/hooks/use-collections";
import { useLibrary } from "@renderer/hooks";

export interface CollectionsModalProps {
  visible: boolean;
  game: Game;
  onClose: () => void;
}

export function CollectionsModal({
  visible,
  game,
  onClose,
}: CollectionsModalProps) {
  const { t } = useTranslation("collections");
  const {
    collections,
    addCollection,
    removeCollection,
    addCollectionGame,
    removeCollectionGame,
  } = useCollections();
  const { updateLibrary } = useLibrary();

  const [collectionTitle, setcollectionTitle] = useState<string>("");

  const handleAddCollection = () => {
    addCollection(collectionTitle);
    setcollectionTitle("");
  };

  const handleRemoveCollection = (collection: Collection) => {
    removeCollection(collection);
    updateLibrary();
  };

  const handleSetCollection = (id: number, addOrRemove: boolean) => {
    addOrRemove ? addCollectionGame(id, game) : removeCollectionGame(id, game);
    updateLibrary();
  };

  return (
    <>
      <Modal
        visible={visible}
        title={t("collections")}
        onClose={onClose}
        large={true}
      >
        <div className={styles.collectionsContainer}>
          <TextField
            value={collectionTitle}
            theme="dark"
            placeholder={t("enter_the_name_of_the_collection")}
            onChange={(e) => setcollectionTitle(e.target.value)}
            rightContent={
              <Button
                type="button"
                theme="outline"
                onClick={handleAddCollection}
              >
                {t("add")}
              </Button>
            }
          />
          {collections.map((collection) => (
            <div className={styles.buttonsContainer} key={collection.id}>
              <Button
                className={styles.buttonSelect}
                type="button"
                theme={
                  collection.games?.some(
                    (collectionGame) => collectionGame.id == game.id
                  )
                    ? "primary"
                    : "outline"
                }
                onClick={() =>
                  handleSetCollection(
                    collection.id,
                    !collection.games?.some(
                      (collectionGame) => collectionGame.id == game.id
                    )
                  )
                }
              >
                {collection.title}
              </Button>
              <Button
                className={styles.buttonRemove}
                type="button"
                theme="danger"
                onClick={() => handleRemoveCollection(collection)}
              >
                {t("remove")}
              </Button>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
