import { Button, type ButtonProps } from "../button/button";
import { Modal, type ModalProps } from "../modal/modal";

import "./confirmation-modal.scss";

export interface ConfirmationModalProps extends Omit<ModalProps, "children"> {
  confirmButtonLabel: string;
  cancelButtonLabel: string;
  descriptionText: string;

  onConfirm: () => void;
  onCancel?: () => void;

  buttonsIsDisabled?: boolean;
  confirmButtonTheme?: ButtonProps["theme"];
}

export function ConfirmationModal({
  confirmButtonLabel,
  cancelButtonLabel,
  descriptionText,
  onConfirm,
  onCancel,
  buttonsIsDisabled = false,
  confirmButtonTheme = "primary",
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
          <Button
            theme="outline"
            disabled={buttonsIsDisabled}
            onClick={handleCancelClick}
          >
            {cancelButtonLabel}
          </Button>
          <Button
            theme={confirmButtonTheme}
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
