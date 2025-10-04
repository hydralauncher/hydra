import { useTranslation } from "react-i18next";
import { Button, Modal } from "@renderer/components";
import "./confirm-modal.scss";

export interface ConfirmModalProps {
  visible: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmTheme?: "primary" | "outline" | "danger";
  confirmDisabled?: boolean;
}

export function ConfirmModal({
  visible,
  title,
  description,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel,
  confirmTheme = "outline",
  confirmDisabled = false,
}: ConfirmModalProps) {
  const { t } = useTranslation();

  const handleConfirm = async () => {
    await onConfirm();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={title}
      description={description}
      onClose={onClose}
    >
      <div className="confirm-modal__actions">
        <Button
          onClick={handleConfirm}
          theme={confirmTheme}
          disabled={confirmDisabled}
        >
          {confirmLabel || t("confirm")}
        </Button>

        <Button onClick={onClose} theme="primary">
          {cancelLabel || t("cancel")}
        </Button>
      </div>
    </Modal>
  );
}
