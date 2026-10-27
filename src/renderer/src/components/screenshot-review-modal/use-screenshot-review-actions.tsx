import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { ConfirmationModal } from "@renderer/components";
import { useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";

import {
  toUploadOptions,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

export function useScreenshotReviewActions(
  screenshot: LocalScreenshot,
  draft: ScreenshotReviewDraft
) {
  const { t } = useTranslation("screenshots_capture");
  const [isBusy, setIsBusy] = useState(false);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast } = useToast();

  const runAction = async (action: () => Promise<unknown>, label: string) => {
    setIsBusy(true);
    try {
      await action();
    } catch (error) {
      logger.error(label, error);
    } finally {
      setIsBusy(false);
    }
  };

  const upload = () => {
    if (!userDetails) {
      showErrorToast(t("upload_sign_in_required"));
      return;
    }

    return runAction(
      () =>
        window.electron.uploadLocalScreenshot(
          screenshot.clientId,
          toUploadOptions(screenshot, draft, hasActiveSubscription)
        ),
      "Failed to upload the screenshot"
    );
  };

  const confirmDelete = () => {
    setIsDeleteModalVisible(false);
    void runAction(
      () => window.electron.deleteLocalScreenshot(screenshot.clientId),
      "Failed to delete the screenshot"
    );
  };

  const elements = (
    <ConfirmationModal
      visible={isDeleteModalVisible}
      title={t("delete_confirm_title")}
      descriptionText={t("delete_confirm_description")}
      confirmButtonLabel={t("delete_confirm_button")}
      cancelButtonLabel={t("cancel")}
      confirmButtonTheme="danger"
      onConfirm={confirmDelete}
      onClose={() => setIsDeleteModalVisible(false)}
    />
  );

  return {
    isBusy,
    upload,
    requestDelete: () => setIsDeleteModalVisible(true),
    elements,
  };
}
