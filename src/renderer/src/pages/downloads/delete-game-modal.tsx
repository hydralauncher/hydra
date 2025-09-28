import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import "./delete-game-modal.scss";

interface DeleteGameModalProps {
  visible: boolean;
  onClose: () => void;
  deleteGame: () => void;
}

export function DeleteGameModal({
  onClose,
  visible,
  deleteGame,
}: Readonly<DeleteGameModalProps>) {
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
      <div className="delete-game-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("cancel")}
        </Button>

        <Button onClick={handleDeleteGame} theme="primary">
          {t("delete")}
        </Button>
      </div>
    </Modal>
  );
}
