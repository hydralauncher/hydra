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
  const [pendingAction, setPendingAction] = useState<
    "upload" | "delete" | null
  >(null);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const { showErrorToast } = useToast();

  const runAction = async (
    kind: "upload" | "delete",
    action: () => Promise<unknown>,
    label: string
  ) => {
    setPendingAction(kind);
    try {
      await action();
    } catch (error) {
      logger.error(label, error);
    } finally {
      setPendingAction(null);
    }
  };

  const upload = () => {
    if (!userDetails) {
      showErrorToast(t("upload_sign_in_required"));
      return;
    }

    return runAction(
      "upload",
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
      "delete",
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
    isBusy: pendingAction !== null,
    isUploadPending: pendingAction === "upload",
    upload,
    requestDelete: () => setIsDeleteModalVisible(true),
    elements,
  };
}
