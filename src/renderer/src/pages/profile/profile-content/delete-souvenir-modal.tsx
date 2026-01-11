import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import "../../../pages/game-details/modals/delete-review-modal.scss";

interface DeleteSouvenirModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteSouvenirModal({
  visible,
  onClose,
  onConfirm,
}: Readonly<DeleteSouvenirModalProps>) {
  const { t } = useTranslation("user_profile");

  const handleDeleteSouvenir = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_souvenir_modal_title")}
      description={t("delete_souvenir_modal_description")}
      onClose={onClose}
    >
      <div className="delete-review-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("delete_souvenir_modal_cancel_button")}
        </Button>

        <Button onClick={handleDeleteSouvenir} theme="danger">
          {t("delete_souvenir_modal_delete_button")}
        </Button>
      </div>
    </Modal>
  );
}
