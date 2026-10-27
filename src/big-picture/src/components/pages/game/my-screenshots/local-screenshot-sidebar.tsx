import {
  ArrowClockwiseIcon,
  CloudArrowUpIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { getLocalScreenshotTitle, isScreenshotUploadRetryable } from "@shared";
import { logger } from "@renderer/logger";

import {
  Button,
  HorizontalFocusGroup,
  VerticalFocusGroup,
} from "../../../common";
import { ConfirmationModal } from "../../../modals";
import {
  ReviewFields,
  ReviewUploadStatus,
  toUploadOptions,
  type ReviewDraft,
  type ReviewFieldFocusIds,
} from "../../../screenshot-review-modal/review-fields";
import type { FocusOverrideTarget } from "../../../../services";
import { useBigPictureToast, useUserDetails } from "../../../../hooks";
import { formatScreenshotDate } from "../../screenshots";
import { ScreenshotDialogPresence } from "../../screenshots/screenshot-dialog-presence";

const BLOCK_TARGET: FocusOverrideTarget = { type: "block" };
const EDITABLE_STATES = new Set<LocalScreenshot["state"]>([
  "local",
  "reviewing",
  "failed",
]);
const UNDECIDED_STATES = new Set<LocalScreenshot["state"]>([
  "local",
  "reviewing",
]);

const getFieldFocusIds = (clientId: string): ReviewFieldFocusIds => ({
  title: `local-screenshot-sidebar-title:${clientId}`,
  description: `local-screenshot-sidebar-description:${clientId}`,
  spoiler: `local-screenshot-sidebar-spoiler:${clientId}`,
  visibility: `local-screenshot-sidebar-visibility:${clientId}`,
  quality: `local-screenshot-sidebar-quality:${clientId}`,
});

const getUploadFocusId = (clientId: string) =>
  `local-screenshot-sidebar-upload:${clientId}`;
const getDeleteFocusId = (clientId: string) =>
  `local-screenshot-sidebar-delete:${clientId}`;

const getUploadLabelKey = (isUploading: boolean, canRetry: boolean) => {
  if (isUploading) return "screenshots_uploading";
  return canRetry ? "screenshots_review_retry" : "screenshots_review_upload";
};

export const getLocalScreenshotSidebarEntryFocusId = (
  screenshot: LocalScreenshot
) => {
  const focusIds = getFieldFocusIds(screenshot.clientId);
  if (!EDITABLE_STATES.has(screenshot.state)) return null;
  return screenshot.shop === "custom" ? focusIds.title : focusIds.description;
};

interface LocalScreenshotSidebarProps {
  screenshot: LocalScreenshot;
  draft: ReviewDraft;
  stageTarget: FocusOverrideTarget;
  onDraftChange: (update: Partial<ReviewDraft>) => void;
  onBeforeUpload: () => void;
}

export function LocalScreenshotSidebar({
  screenshot,
  draft,
  stageTarget,
  onDraftChange,
  onBeforeUpload,
}: Readonly<LocalScreenshotSidebarProps>) {
  const { t, i18n } = useTranslation("big_picture");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";
  const { showErrorToast } = useBigPictureToast();
  const { userDetails, hasActiveSubscription } = useUserDetails();
  const [pendingAction, setPendingAction] = useState<
    "upload" | "delete" | null
  >(null);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const { clientId } = screenshot;
  const isCustomGame = screenshot.shop === "custom";
  const isUndecided = UNDECIDED_STATES.has(screenshot.state);
  const canRetry =
    screenshot.state === "failed" &&
    isScreenshotUploadRetryable(screenshot.lastError);
  const canUpload = isUndecided || canRetry;
  const isBusy = pendingAction !== null;
  const uploadFocusId = getUploadFocusId(clientId);
  const deleteFocusId = getDeleteFocusId(clientId);
  const fieldFocusIds = getFieldFocusIds(clientId);
  const isEditable = EDITABLE_STATES.has(screenshot.state);
  const isUploading =
    pendingAction === "upload" ||
    screenshot.state === "queued" ||
    screenshot.state === "uploading";
  const hasForm = isEditable || isUploading;

  const runAction = async (
    action: "upload" | "delete",
    task: () => Promise<unknown>
  ) => {
    setPendingAction(action);
    try {
      return await task();
    } catch (error) {
      logger.error(`Failed to ${action} the local screenshot`, error);
      showErrorToast(t("screenshots_review_action_failed"), {
        fallbackVisual: "settings",
      });
      return null;
    } finally {
      setPendingAction(null);
    }
  };

  const upload = async () => {
    if (!userDetails) {
      showErrorToast(t("screenshots_sign_in_to_upload"), {
        fallbackVisual: "settings",
      });
      return;
    }

    onBeforeUpload();
    await runAction("upload", () =>
      globalThis.window.electron.uploadLocalScreenshot(
        clientId,
        toUploadOptions(draft, isCustomGame, hasActiveSubscription)
      )
    );
  };

  const remove = async () => {
    await runAction("delete", () =>
      globalThis.window.electron.deleteLocalScreenshot(clientId)
    );
    setIsDeleteConfirmVisible(false);
  };

  return (
    <VerticalFocusGroup
      regionId={`local-screenshot-sidebar:${clientId}`}
      asChild
    >
      <div className="screenshot-viewer-sidebar local-screenshot-sidebar">
        <div className="screenshot-viewer-sidebar__details">
          <div className="screenshot-lightbox__summary">
            <span className="screenshot-lightbox__game">
              <span className="screenshot-lightbox__game-title">
                {getLocalScreenshotTitle(screenshot)}
              </span>
            </span>
            <span className="screenshot-lightbox__date">
              {formatScreenshotDate(screenshot.capturedAt, language)}
            </span>
            <span className="local-screenshot-sidebar__badge">
              {t("screenshots_not_uploaded")}
            </span>
          </div>

          {hasForm ? (
            <div className="local-screenshot-sidebar__fields">
              <ReviewFields
                clientId={clientId}
                draft={draft}
                isCustomGame={isCustomGame}
                disabled={isBusy || isUploading}
                focusIds={fieldFocusIds}
                leftTarget={stageTarget}
                downTarget={{
                  type: "item",
                  itemId: canUpload ? uploadFocusId : deleteFocusId,
                }}
                onChange={onDraftChange}
              />
            </div>
          ) : null}

          <div className="local-screenshot-sidebar__footer">
            {isUndecided || isUploading ? null : (
              <ReviewUploadStatus screenshot={screenshot} />
            )}
            {hasForm ? (
              <HorizontalFocusGroup
                regionId={`local-screenshot-sidebar-actions:${clientId}`}
                asChild
              >
                <div className="local-screenshot-sidebar__actions">
                  {canUpload || isUploading ? (
                    <Button
                      focusId={uploadFocusId}
                      focusNavigationOverrides={{
                        left: stageTarget,
                        up: hasForm
                          ? { type: "item", itemId: fieldFocusIds.quality }
                          : BLOCK_TARGET,
                      }}
                      disabled={isBusy}
                      loading={isUploading}
                      icon={
                        canRetry ? (
                          <ArrowClockwiseIcon size={18} />
                        ) : (
                          <CloudArrowUpIcon size={18} />
                        )
                      }
                      className="local-screenshot-sidebar__upload"
                      onClick={() => void upload()}
                    >
                      {t(getUploadLabelKey(isUploading, canRetry))}
                    </Button>
                  ) : null}
                  <Button
                    variant="danger"
                    size="icon"
                    focusId={deleteFocusId}
                    focusNavigationOverrides={{
                      left:
                        canUpload || isUploading
                          ? { type: "item", itemId: uploadFocusId }
                          : stageTarget,
                      right: BLOCK_TARGET,
                      up: hasForm
                        ? { type: "item", itemId: fieldFocusIds.quality }
                        : BLOCK_TARGET,
                    }}
                    disabled={isBusy || isUploading}
                    loading={pendingAction === "delete"}
                    icon={<TrashIcon size={20} />}
                    aria-label={t("screenshots_review_delete")}
                    title={t("screenshots_review_delete")}
                    className="local-screenshot-sidebar__delete"
                    onClick={() => setIsDeleteConfirmVisible(true)}
                  >
                    {null}
                  </Button>
                </div>
              </HorizontalFocusGroup>
            ) : null}
          </div>
        </div>

        <ScreenshotDialogPresence isOpen={isDeleteConfirmVisible} />
        <ConfirmationModal
          visible={isDeleteConfirmVisible}
          backdropClassName="screenshot-lightbox__confirmation-backdrop"
          title={t("screenshots_review_delete_title")}
          description={t("screenshots_review_delete_description")}
          confirmLabel={t("screenshots_review_delete")}
          cancelLabel={t("screenshots_cancel")}
          danger
          loading={pendingAction === "delete"}
          onClose={() => setIsDeleteConfirmVisible(false)}
          onConfirm={remove}
        />
      </div>
    </VerticalFocusGroup>
  );
}
