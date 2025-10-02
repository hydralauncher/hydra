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
}: DeleteReviewModalProps) {
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
      <div className="delete-review-modal__karma-warning">
        {t("delete_review_karma_warning")}
      </div>

      <div className="delete-review-modal__actions">
        <Button onClick={onClose} theme="outline">
          {t("cancel")}
        </Button>

        <Button onClick={handleDeleteReview} theme="primary">
          {t("delete")}
        </Button>
      </div>
    </Modal>
  );
}
