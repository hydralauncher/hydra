import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import "./sensitive-screenshot-modal.scss";
import { CheckboxField } from "../checkbox-field/checkbox-field";
import { ConfirmationModal } from "../confirmation-modal/confirmation-modal";
import { setUserPreferences } from "@renderer/features";
import { useAppDispatch } from "@renderer/hooks";
import { logger } from "@renderer/logger";
import { levelDBService } from "@renderer/services/leveldb.service";
import type { UserPreferences } from "@types";

interface SensitiveScreenshotModalProps {
  visible: boolean;
  isSpoiler: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function SensitiveScreenshotModal({
  visible,
  isSpoiler,
  onConfirm,
  onClose,
}: Readonly<SensitiveScreenshotModalProps>) {
  const { t } = useTranslation("screenshots");
  const dispatch = useAppDispatch();
  const [alwaysShow, setAlwaysShow] = useState(false);

  useEffect(() => {
    if (visible) setAlwaysShow(false);
  }, [visible]);

  const persistAlwaysShow = async () => {
    try {
      await window.electron.updateUserPreferences({
        showSensitiveScreenshots: true,
      });
      const preferences = await levelDBService.get(
        "userPreferences",
        null,
        "json"
      );
      dispatch(setUserPreferences(preferences as UserPreferences | null));
    } catch (error) {
      logger.error(
        "Failed to save the sensitive screenshots preference",
        error
      );
    }
  };

  const handleConfirm = () => {
    if (alwaysShow) void persistAlwaysShow();
    onConfirm();
  };

  return (
    <ConfirmationModal
      visible={visible}
      title={t("sensitive_modal_title")}
      descriptionText={t(
        isSpoiler
          ? "sensitive_modal_description_spoiler"
          : "sensitive_modal_description"
      )}
      confirmButtonLabel={t("sensitive_modal_confirm")}
      cancelButtonLabel={t("cancel")}
      onConfirm={handleConfirm}
      onClose={onClose}
    >
      <div className="sensitive-screenshot-modal__preference">
        <CheckboxField
          label={t("screenshots_show_sensitive", { ns: "settings" })}
          checked={alwaysShow}
          onChange={(event) => setAlwaysShow(event.target.checked)}
        />
        <p className="sensitive-screenshot-modal__hint">
          {t("sensitive_modal_settings_hint")}
        </p>
      </div>
    </ConfirmationModal>
  );
}
