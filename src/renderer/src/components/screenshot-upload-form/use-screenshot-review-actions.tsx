import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { ConfirmationModal } from "@renderer/components";
import { useFeature, useToast, useUserDetails } from "@renderer/hooks";
import { logger } from "@renderer/logger";

import {
  toUploadOptions,
  type ScreenshotReviewDraft,
} from "./screenshot-review-state";

const UPLOAD_SIGNED_OUT_ERROR = "user not logged in";
const UPLOAD_MISSING_FILE_ERROR = "screenshot_missing";
const AWAITED_UPLOAD_STATE_TIMEOUT_MS = 5000;

export function useScreenshotReviewActions(
  screenshot: LocalScreenshot,
  draft: ScreenshotReviewDraft
) {
  const { t } = useTranslation("screenshots_capture");
  const [pendingAction, setPendingAction] = useState<
    "upload" | "delete" | null
  >(null);
  const [isDeleteModalVisible, setIsDeleteModalVisible] = useState(false);
  const [awaitedUploadState, setAwaitedUploadState] = useState<
    LocalScreenshot["state"] | null
  >(null);
  const { userDetails } = useUserDetails();
  const { showErrorToast } = useToast();
  const { isFeatureEnabled, Feature } = useFeature();

  useEffect(() => {
    if (awaitedUploadState === null) return;
    if (screenshot.state !== awaitedUploadState) {
      setAwaitedUploadState(null);
      return;
    }

    const timeout = setTimeout(
      () => setAwaitedUploadState(null),
      AWAITED_UPLOAD_STATE_TIMEOUT_MS
    );
    return () => clearTimeout(timeout);
  }, [awaitedUploadState, screenshot.state]);

  const runAction = async (
    kind: "upload" | "delete",
    action: () => Promise<unknown>,
    label: string,
    getErrorMessage: (error: unknown) => string
  ) => {
    setPendingAction(kind);
    try {
      await action();
    } catch (error) {
      logger.error(label, error);
      showErrorToast(getErrorMessage(error));
    } finally {
      setPendingAction(null);
    }
  };

  const getUploadErrorMessage = (error: unknown) => {
    const message = error instanceof Error ? error.message : "";
    if (message.includes(UPLOAD_SIGNED_OUT_ERROR)) {
      return t("upload_sign_in_required");
    }
    if (message.includes(UPLOAD_MISSING_FILE_ERROR)) {
      return t("error_missing_file");
    }
    return t("error_generic");
  };

  const upload = () => {
    if (!userDetails) {
      showErrorToast(t("upload_sign_in_required"));
      return;
    }

    const requestedFromState = screenshot.state;

    return runAction(
      "upload",
      async () => {
        const queued = await window.electron.uploadLocalScreenshot(
          screenshot.clientId,
          {
            ...toUploadOptions(screenshot, draft),
            commentsEnabled:
              draft.commentsEnabled ||
              !isFeatureEnabled(Feature.ScreenshotComments),
          }
        );
        if (queued && queued.state !== requestedFromState) {
          setAwaitedUploadState(requestedFromState);
        }
      },
      "Failed to upload the screenshot",
      getUploadErrorMessage
    );
  };

  const confirmDelete = () => {
    setIsDeleteModalVisible(false);
    void runAction(
      "delete",
      () => window.electron.deleteLocalScreenshot(screenshot.clientId),
      "Failed to delete the screenshot",
      () => t("delete_failed", { ns: "screenshots" })
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
    isBusy: pendingAction !== null || awaitedUploadState !== null,
    isUploadPending: pendingAction === "upload" || awaitedUploadState !== null,
    upload,
    requestDelete: () => setIsDeleteModalVisible(true),
    elements,
  };
}
