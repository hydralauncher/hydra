import { useTranslation } from "react-i18next";

import { Button, Modal } from "@renderer/components";

import * as styles from "./delete-game-modal.css";

interface DeleteGameModalProps {
  visible: boolean;
  onClose: () => void;
  deleteGame: () => void;
}

export function DeleteGameModal({
  onClose,
  visible,
  deleteGame,
}: DeleteGameModalProps) {
  const { t } = useTranslation("downloads");

  const handleDeleteGame = () => {
    deleteGame();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_modal_title")}
      description={t("delete_modal_description")}
      onClose={onClose}
    >
      <div className={styles.deleteActionsButtonsCtn}>
        <Button onClick={handleDeleteGame} theme="outline">
          {t("delete")}
        </Button>

        <Button onClick={onClose} theme="primary">
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
}
