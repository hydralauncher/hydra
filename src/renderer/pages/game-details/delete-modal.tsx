import { Button, Modal } from "@renderer/components";
import { useTranslation } from "react-i18next";
import * as styles from "./delete-modal.css";

interface DeleteModalProps {
  visible: boolean;
  onClose: () => void;
  deleting: boolean;
  deleteGame: () => void;
}

export function DeleteModal({
  onClose,
  visible,
  deleting,
  deleteGame,
}: DeleteModalProps) {
  const { t } = useTranslation("game_details");

  function handleDeleteGame() {
    deleteGame();
    onClose();
  }

  return (
    <Modal
      visible={visible}
      title={t("delete_modal_title")}
      description={t("delete_modal_description")}
      onClose={onClose}
    >
      <div className={styles.deleteActionsButtonsCtn}>
        <Button onClick={handleDeleteGame} theme="outline" disabled={deleting}>
          {t("delete")}
        </Button>

        <Button onClick={onClose} theme="primary" disabled={deleting}>
          {t("cancel")}
        </Button>
      </div>
    </Modal>
  );
}
