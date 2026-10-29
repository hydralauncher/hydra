import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { GameShop } from "@types";
import { Button, CheckboxField, Modal } from "@renderer/components";
import { useSourceArchive } from "@renderer/hooks/use-source-archive";
import "./delete-game-modal.scss";

interface DeleteGameModalProps {
  visible: boolean;
  onClose: () => void;
  deleteGame: (deleteSourceArchive: boolean) => void;
  target?: { shop: GameShop; objectId: string } | null;
}

export function DeleteGameModal({
  onClose,
  visible,
  deleteGame,
  target,
}: Readonly<DeleteGameModalProps>) {
  const { t } = useTranslation("downloads");
  const hasSourceArchive = useSourceArchive(target, visible);
  const [deleteSourceArchive, setDeleteSourceArchive] = useState(false);

  useEffect(() => {
    if (visible) setDeleteSourceArchive(false);
  }, [visible]);

  const handleDeleteGame = () => {
    deleteGame(hasSourceArchive && deleteSourceArchive);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_modal_title")}
      description={t("delete_modal_description")}
      onClose={onClose}
    >
      {hasSourceArchive && (
        <div className="delete-game-modal__options">
          <CheckboxField
            label={t("delete_source_archive")}
            checked={deleteSourceArchive}
            onChange={(event) => setDeleteSourceArchive(event.target.checked)}
          />
        </div>
      )}

      <div className="delete-game-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("cancel")}
        </Button>

        <Button onClick={handleDeleteGame} theme="danger">
          {t("delete")}
        </Button>
      </div>
    </Modal>
  );
}
