import { Button } from "../button/button";
import { Modal, type ModalProps } from "../modal/modal";

import "./confirmation-modal.scss";

export interface ConfirmationModalProps extends Omit<ModalProps, "children"> {
  confirmButtonLabel: string;
  cancelButtonLabel: string;
  descriptionText: string;

  onConfirm: () => void;
  onCancel?: () => void;
}

export function ConfirmationModal({
  confirmButtonLabel,
  cancelButtonLabel,
  descriptionText,
  onConfirm,
  onCancel,
  ...props
}: ConfirmationModalProps) {
  const handleCancelClick = () => {
    if (onCancel) {
      onCancel();
      return;
    }

    props.onClose();
  };

  return (
    <Modal {...props}>
      <div className="confirmation-modal">
        <p className="confirmation-modal__description">{descriptionText}</p>

        <div className="confirmation-modal__actions">
          <Button theme="outline" onClick={handleCancelClick}>
            {cancelButtonLabel}
          </Button>
          <Button theme="danger" onClick={onConfirm}>
            {confirmButtonLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
