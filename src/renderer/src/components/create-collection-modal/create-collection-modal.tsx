import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameCollection } from "@types";

import { Button, Modal, TextField } from "@renderer/components";
import { useGameCollections, useToast } from "@renderer/hooks";

import "./create-collection-modal.scss";

export interface CreateCollectionModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated?: (collection: GameCollection) => void;
}

export function CreateCollectionModal({
  visible,
  onClose,
  onCreated,
}: Readonly<CreateCollectionModalProps>) {
  const { t } = useTranslation("sidebar");
  const { showSuccessToast, showErrorToast } = useToast();
  const { createCollection } = useGameCollections();

  const [name, setName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleClose = () => {
    if (isCreating) return;
    setName("");
    onClose();
  };

  const resolveErrorMessage = (error: unknown) => {
    if (!(error instanceof Error)) return t("failed_create_collection");

    if (error.message.includes("game/collection-limit-reached")) {
      return t("collection_limit_reached");
    }

    if (error.message.includes("game/collection-name-already-in-use")) {
      return t("collection_name_already_in_use");
    }

    return t("failed_create_collection");
  };

  const handleCreate = async () => {
    const collectionName = name.trim();

    if (!collectionName) {
      showErrorToast(t("collection_name_required"));
      return;
    }

    setIsCreating(true);

    try {
      const createdCollection = await createCollection(collectionName);
      showSuccessToast(t("collection_created"));

      onCreated?.(createdCollection);
      setName("");
      onClose();
    } catch (error) {
      showErrorToast(resolveErrorMessage(error));
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Modal
      visible={visible}
      title={t("create_collection")}
      description={t("create_collection_description")}
      onClose={handleClose}
    >
      <div className="create-collection-modal__container">
        <TextField
          label={t("collection_name")}
          placeholder={t("collection_name_placeholder")}
          value={name}
          onChange={(event) => setName(event.target.value)}
          theme="dark"
          disabled={isCreating}
          maxLength={60}
        />

        <div className="create-collection-modal__actions">
          <Button
            type="button"
            theme="outline"
            onClick={handleClose}
            disabled={isCreating}
          >
            {t("cancel")}
          </Button>

          <Button
            type="button"
            theme="primary"
            onClick={handleCreate}
            disabled={!name.trim() || isCreating}
          >
            {isCreating ? t("creating_collection") : t("create")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
