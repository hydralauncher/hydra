import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { logger } from "@renderer/logger";

import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../common";
import { useNavigation } from "../../../hooks";

import "../../modals/confirmation/styles.scss";
import "./sensitive-screenshot-modal.scss";

const CONTENT_REGION_ID = "sensitive-screenshot-modal-content";
const ACTIONS_REGION_ID = "sensitive-screenshot-modal-actions";
const CHECKBOX_FOCUS_ID = "sensitive-screenshot-modal-dont-hide";
const CANCEL_FOCUS_ID = "sensitive-screenshot-modal-cancel";
const CONFIRM_FOCUS_ID = "sensitive-screenshot-modal-confirm";

interface SensitiveScreenshotModalProps {
  visible: boolean;
  isSpoiler: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function SensitiveScreenshotModal({
  visible,
  isSpoiler,
  onClose,
  onConfirm,
}: Readonly<SensitiveScreenshotModalProps>) {
  const { t } = useTranslation("big_picture");
  const { setFocus } = useNavigation();
  const [dontHideAgain, setDontHideAgain] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;

    setDontHideAgain(false);
    setIsSaving(false);

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(CANCEL_FOCUS_ID);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [setFocus, visible]);

  const confirm = async () => {
    if (dontHideAgain) {
      setIsSaving(true);
      try {
        await globalThis.window.electron.updateUserPreferences({
          showSensitiveScreenshots: true,
        });
      } catch (error) {
        logger.error(
          "Failed to save the sensitive screenshots preference",
          error
        );
      } finally {
        setIsSaving(false);
      }
    }

    onConfirm();
  };

  return (
    <Modal
      visible={visible}
      onClose={onClose}
      title={t("screenshots_sensitive_warning")}
      description={t(
        isSpoiler
          ? "screenshots_sensitive_modal_description_spoiler"
          : "screenshots_sensitive_modal_description"
      )}
      initialFocusId={CANCEL_FOCUS_ID}
      closeOnBackdrop={false}
      closeOnEscape={!isSaving}
      closeOnB={!isSaving}
      className="confirmation-modal sensitive-screenshot-modal"
    >
      <VerticalFocusGroup
        regionId={CONTENT_REGION_ID}
        className="confirmation-modal__content sensitive-screenshot-modal__content"
      >
        <Checkbox
          block
          label={t("screenshots_sensitive_modal_dont_hide")}
          checked={dontHideAgain}
          disabled={isSaving}
          focusId={CHECKBOX_FOCUS_ID}
          navigationOverrides={{
            up: { type: "block" },
            down: { type: "item", itemId: CANCEL_FOCUS_ID },
            left: { type: "block" },
            right: { type: "block" },
          }}
          onChange={setDontHideAgain}
        />

        <HorizontalFocusGroup
          regionId={ACTIONS_REGION_ID}
          className="confirmation-modal__actions"
        >
          <Button
            variant="secondary"
            focusId={CANCEL_FOCUS_ID}
            disabled={isSaving}
            focusNavigationOverrides={{
              up: { type: "item", itemId: CHECKBOX_FOCUS_ID },
              down: { type: "block" },
            }}
            onClick={onClose}
          >
            {t("screenshots_cancel")}
          </Button>

          <Button
            variant="primary"
            focusId={CONFIRM_FOCUS_ID}
            loading={isSaving}
            focusNavigationOverrides={{
              up: { type: "item", itemId: CHECKBOX_FOCUS_ID },
              down: { type: "block" },
            }}
            onClick={() => {
              void confirm();
            }}
          >
            {t("screenshots_sensitive_reveal")}
          </Button>
        </HorizontalFocusGroup>
      </VerticalFocusGroup>
    </Modal>
  );
}
