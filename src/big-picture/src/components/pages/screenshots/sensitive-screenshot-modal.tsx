import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { logger } from "@renderer/logger";

import {
  Button,
  Checkbox,
  HorizontalFocusGroup,
  Modal,
  VerticalFocusGroup,
} from "../../common";
import { useNavigationActions } from "../../../hooks";

import "../../modals/confirmation/styles.scss";
import "./sensitive-screenshot-modal.scss";

const getModalIds = (instanceId: string) => ({
  contentRegion: `sensitive-screenshot-modal-content:${instanceId}`,
  actionsRegion: `sensitive-screenshot-modal-actions:${instanceId}`,
  checkbox: `sensitive-screenshot-modal-dont-hide:${instanceId}`,
  cancel: `sensitive-screenshot-modal-cancel:${instanceId}`,
  confirm: `sensitive-screenshot-modal-confirm:${instanceId}`,
});

interface SensitiveScreenshotModalProps {
  visible: boolean;
  isSpoiler: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onExitComplete?: () => void;
}

export function SensitiveScreenshotModal({
  visible,
  isSpoiler,
  onClose,
  onConfirm,
  onExitComplete,
}: Readonly<SensitiveScreenshotModalProps>) {
  const { t } = useTranslation("big_picture");
  const { setFocus } = useNavigationActions();
  const ids = getModalIds(useId().replaceAll(":", ""));
  const [dontHideAgain, setDontHideAgain] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;

    setDontHideAgain(false);
    setIsSaving(false);

    const frameId = globalThis.window.requestAnimationFrame(() => {
      setFocus(ids.cancel);
    });

    return () => {
      globalThis.window.cancelAnimationFrame(frameId);
    };
  }, [ids.cancel, setFocus, visible]);

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
      initialFocusId={ids.cancel}
      closeOnBackdrop={false}
      closeOnEscape={!isSaving}
      busy={isSaving}
      className="confirmation-modal sensitive-screenshot-modal"
      backdropClassName="sensitive-screenshot-modal__backdrop"
      onExitComplete={onExitComplete}
    >
      <VerticalFocusGroup
        regionId={ids.contentRegion}
        className="confirmation-modal__content sensitive-screenshot-modal__content"
      >
        <Checkbox
          block
          label={t("screenshots_sensitive_modal_dont_hide")}
          secondaryText={t("screenshots_sensitive_modal_settings_hint")}
          checked={dontHideAgain}
          disabled={isSaving}
          focusId={ids.checkbox}
          navigationOverrides={{
            up: { type: "block" },
            down: { type: "item", itemId: ids.cancel },
            left: { type: "block" },
            right: { type: "block" },
          }}
          onChange={setDontHideAgain}
        />

        <HorizontalFocusGroup
          regionId={ids.actionsRegion}
          className="confirmation-modal__actions"
        >
          <Button
            variant="secondary"
            focusId={ids.cancel}
            disabled={isSaving}
            focusNavigationOverrides={{
              up: { type: "item", itemId: ids.checkbox },
              down: { type: "block" },
            }}
            onClick={onClose}
          >
            {t("screenshots_cancel")}
          </Button>

          <Button
            variant="primary"
            focusId={ids.confirm}
            loading={isSaving}
            focusNavigationOverrides={{
              up: { type: "item", itemId: ids.checkbox },
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
