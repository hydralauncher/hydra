import { Button } from "../button/button";
import { Modal, type ModalProps } from "../modal/modal";

import * as styles from "./confirmation-modal.css";

export interface ConfirmationModalProps extends ModalProps {
  confirmButtonLabel: string;
  cancelButtonLabel: string;
  descriptionText: string;
}

export function ConfirmationModal({
  confirmButtonLabel,
  cancelButtonLabel,
  descriptionText,
  ...props
}: ConfirmationModalProps) {
  return (
    <Modal {...props}>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        <p className={styles.descriptionText}>{descriptionText}</p>

        <div className={styles.actions}>
          <Button theme="danger">{cancelButtonLabel}</Button>
          <Button>{confirmButtonLabel}</Button>
        </div>
      </div>
    </Modal>
  );
}
