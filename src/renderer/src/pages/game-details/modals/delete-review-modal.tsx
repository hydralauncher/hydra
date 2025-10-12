import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import "./delete-review-modal.scss";

interface DeleteReviewModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteReviewModal({
  visible,
  onClose,
  onConfirm,
}: Readonly<DeleteReviewModalProps>) {
  const { t } = useTranslation("game_details");

  const handleDeleteReview = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("delete_review_modal_title")}
      description={t("delete_review_modal_description")}
      onClose={onClose}
    >
      <div className="delete-review-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("delete_review_modal_cancel_button")}
        </Button>

        <Button onClick={handleDeleteReview} theme="danger">
          {t("delete_review_modal_delete_button")}
        </Button>
      </div>
    </Modal>
  );
}
