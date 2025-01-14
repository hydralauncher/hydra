import { Button } from "../button/button";
import { Modal, type ModalProps } from "../modal/modal";

import * as styles from "./confirmation-modal.css";

export interface ConfirmationModalProps extends Omit<ModalProps, "children"> {
  confirmButtonLabel: string;
  cancelButtonLabel: string;
  descriptionText: string;

  onConfirm: () => void;
  onCancel?: () => void;

  buttonsIsDisabled?: boolean;
}

export function ConfirmationModal({
  confirmButtonLabel,
  cancelButtonLabel,
  descriptionText,
  onConfirm,
  onCancel,
  buttonsIsDisabled = false,
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
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className={styles.descriptionText}>{descriptionText}</p>

        <div className={styles.actions}>
          <Button
            theme="outline"
            disabled={buttonsIsDisabled}
            onClick={handleCancelClick}
          >
            {cancelButtonLabel}
          </Button>
          <Button
            theme="danger"
            disabled={buttonsIsDisabled}
            onClick={onConfirm}
          >
            {confirmButtonLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
