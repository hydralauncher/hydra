import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthPage } from "@shared";
import type { GameCollection } from "@types";

import { Button, Modal, TextField } from "@renderer/components";
import { useGameCollections, useToast, useUserDetails } from "@renderer/hooks";

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
  const { userDetails } = useUserDetails();
  const { createCollection } = useGameCollections();

  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const handleClose = () => {
    if (isCreating) return;
    setName("");
    setNameError(null);
    onClose();
  };

  const getCollectionErrorCode = (error: unknown): string | null => {
    if (error instanceof Error) {
      if (error.message.includes("game/collection-name-already-in-use")) {
        return "game/collection-name-already-in-use";
      }

      if (error.message.includes("game/collection-limit-reached")) {
        return "game/collection-limit-reached";
      }

      if (error.message.includes("game/collection-name-required")) {
        return "game/collection-name-required";
      }
    }

    if (typeof error === "object" && error !== null) {
      const response = (
        error as { response?: { data?: { message?: unknown } } }
      ).response;
      const responseMessage = response?.data?.message;

      if (typeof responseMessage === "string") {
        return responseMessage;
      }
    }

    return null;
  };

  const resolveErrorMessage = (error: unknown) => {
    const errorCode = getCollectionErrorCode(error);

    if (errorCode === "game/collection-limit-reached") {
      return t("collection_limit_reached");
    }

    if (errorCode === "game/collection-name-already-in-use") {
      return t("collection_name_already_in_use");
    }

    if (errorCode === "game/collection-name-required") {
      return t("collection_name_required");
    }

    return t("failed_create_collection");
  };

  const handleCreate = async () => {
    if (!userDetails) {
      window.electron.openAuthWindow(AuthPage.SignIn);
      handleClose();
      return;
    }

    const collectionName = name.trim();

    if (!collectionName) {
      setNameError(t("collection_name_required"));
      return;
    }

    setNameError(null);
    setIsCreating(true);

    try {
      const createdCollection = await createCollection(collectionName);
      showSuccessToast(t("collection_created"));

      onCreated?.(createdCollection);
      setName("");
      onClose();
    } catch (error) {
      const errorCode = getCollectionErrorCode(error);

      if (errorCode === "game/collection-name-already-in-use") {
        setNameError(t("collection_name_already_in_use"));
      } else if (errorCode === "game/collection-name-required") {
        setNameError(t("collection_name_required"));
      } else {
        showErrorToast(resolveErrorMessage(error));
      }
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
          onChange={(event) => {
            setName(event.target.value);
            if (nameError) setNameError(null);
          }}
          theme="dark"
          disabled={isCreating}
          maxLength={60}
          error={nameError}
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
