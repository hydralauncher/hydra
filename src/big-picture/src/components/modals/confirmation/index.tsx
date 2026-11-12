import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigation } from "../../../hooks";
import {
  Button,
  Checkbox,
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
  cancelLabel?: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  onExitComplete?: () => void;
  loading?: boolean;
  danger?: boolean;
  closeOnBackdrop?: boolean;
  backdropClassName?: string;
  sourceArchiveOption?: SourceArchiveOptionProps | null;
}

export interface SourceArchiveOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const CONFIRMATION_MODAL_CONTENT_REGION_ID = "confirmation-modal-content";
const CONFIRMATION_MODAL_ACTIONS_REGION_ID = "confirmation-modal-actions";
const CONFIRMATION_MODAL_CANCEL_BUTTON_ID = "confirmation-modal-cancel-button";

export function ConfirmationModal({
  visible,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  onClose,
  onConfirm,
  onExitComplete,
  loading = false,
  danger = false,
  closeOnBackdrop = true,
  backdropClassName,
  sourceArchiveOption = null,
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
      initialFocusId={CONFIRMATION_MODAL_CANCEL_BUTTON_ID}
      description={description}
      closeOnBackdrop={closeOnBackdrop && !loading}
      closeOnEscape={!loading}
      busy={loading}
      className="confirmation-modal"
      backdropClassName={backdropClassName}
      onExitComplete={onExitComplete}
    >
      <VerticalFocusGroup
        regionId={CONFIRMATION_MODAL_CONTENT_REGION_ID}
        className="confirmation-modal__content"
      >
        {sourceArchiveOption && (
          <SourceArchiveOption
            checked={sourceArchiveOption.checked}
            disabled={loading}
            onChange={sourceArchiveOption.onChange}
          />
        )}

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
            {cancelLabel}
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

function SourceArchiveOption({
  checked,
  disabled,
  onChange,
}: Readonly<SourceArchiveOptionProps & { disabled: boolean }>) {
  const { t } = useTranslation("downloads");

  return (
    <Checkbox
      block
      label={t("delete_source_archive")}
      checked={checked}
      disabled={disabled}
      onChange={onChange}
    />
  );
}
