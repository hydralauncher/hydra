import { useEffect } from "react";
import { useNavigation } from "../../../hooks";
import {
  Button,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../common";

import "./styles.scss";

interface ConfirmationModalProps {
  visible: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  loading?: boolean;
  danger?: boolean;
}

const CONFIRMATION_MODAL_CONTENT_REGION_ID = "confirmation-modal-content";
const CONFIRMATION_MODAL_ACTIONS_REGION_ID = "confirmation-modal-actions";
const CONFIRMATION_MODAL_CANCEL_BUTTON_ID = "confirmation-modal-cancel-button";

export function ConfirmationModal({
  visible,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  loading = false,
  danger = false,
}: Readonly<ConfirmationModalProps>) {
  const { setFocus } = useNavigation();

  useEffect(() => {
    if (!visible) return;

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(CONFIRMATION_MODAL_CANCEL_BUTTON_ID);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [setFocus, visible]);

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={title}
      description={description}
      closeOnBackdrop={!loading}
      closeOnEscape={!loading}
      closeOnB={!loading}
      className="confirmation-modal"
    >
      <VerticalFocusGroup
        regionId={CONFIRMATION_MODAL_CONTENT_REGION_ID}
        className="confirmation-modal__content"
      >
        <HorizontalFocusGroup
          regionId={CONFIRMATION_MODAL_ACTIONS_REGION_ID}
          className="confirmation-modal__actions"
        >
          <Button
            variant="secondary"
            focusId={CONFIRMATION_MODAL_CANCEL_BUTTON_ID}
            disabled={loading}
            onClick={onClose}
          >
            Cancel
          </Button>

          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            onClick={() => {
              void onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
