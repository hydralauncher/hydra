import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LocalScreenshot } from "@types";
import { getLocalScreenshotTitle } from "@shared";
import { logger } from "@renderer/logger";

import { ConfirmationModal } from "../../../modals";
import { requestScreenshotReview } from "../../../screenshot-review-modal";
import { useBigPictureToast } from "../../../../hooks";
import { formatScreenshotDate } from "../../screenshots";
import { ScreenshotDialogPresence } from "../../screenshots/screenshot-dialog-presence";

export function useLocalScreenshotAlt() {
  const { t, i18n } = useTranslation("screenshots");
  const language = i18n.resolvedLanguage ?? i18n.language ?? "en";

  return useCallback(
    (screenshot: LocalScreenshot) =>
      t("screenshot_alt", {
        game: getLocalScreenshotTitle(screenshot),
        date: formatScreenshotDate(screenshot.capturedAt, language),
      }),
    [language, t]
  );
}

const REVIEWABLE_STATES = new Set<LocalScreenshot["state"]>([
  "local",
  "reviewing",
  "failed",
]);

const getReviewOrder = (
  screenshots: LocalScreenshot[],
  selected: LocalScreenshot
) => [
  selected.clientId,
  ...screenshots
    .filter(
      (screenshot) =>
        screenshot.clientId !== selected.clientId &&
        REVIEWABLE_STATES.has(screenshot.state)
    )
    .map((screenshot) => screenshot.clientId),
];

export function useLocalScreenshotActions(screenshots: LocalScreenshot[]) {
  const { t } = useTranslation("big_picture");
  const { showErrorToast, showSuccessToast } = useBigPictureToast();
  const describe = useLocalScreenshotAlt();
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingDelete, setPendingDelete] = useState<LocalScreenshot | null>(
    null
  );

  const setBusy = useCallback((clientId: string, isBusy: boolean) => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (isBusy) next.add(clientId);
      else next.delete(clientId);
      return next;
    });
  }, []);

  const upload = useCallback((screenshot: LocalScreenshot) => {
    requestScreenshotReview({
      gameKey: `manual:${screenshot.clientId}`,
      shop: screenshot.shop,
      objectId: screenshot.objectId ?? "",
      gameTitle: getLocalScreenshotTitle(screenshot),
      clientIds: [screenshot.clientId],
    });
  }, []);

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { clientId } = pendingDelete;
    setBusy(clientId, true);
    try {
      await globalThis.window.electron.deleteLocalScreenshot(clientId);
      setPendingDelete(null);
      showSuccessToast(t("screenshots_deleted"));
    } catch (error) {
      logger.error("Failed to delete the local screenshot", error);
      showErrorToast(t("delete_failed", { ns: "screenshots" }));
    } finally {
      setBusy(clientId, false);
    }
  };

  const elements = (
    <>
      <ScreenshotDialogPresence isOpen={pendingDelete !== null} />
      <ConfirmationModal
        visible={pendingDelete !== null}
        backdropClassName="local-screenshot-viewer__confirmation-backdrop"
        title={t("screenshots_review_delete_title")}
        description={t("delete_local_screenshot_description", {
          ns: "screenshots",
        })}
        confirmLabel={t("screenshots_review_delete")}
        cancelLabel={t("screenshots_cancel")}
        danger
        loading={pendingDelete ? busyIds.has(pendingDelete.clientId) : false}
        onClose={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
      />
    </>
  );

  return {
    busyIds,
    describe,
    upload,
    requestDelete: setPendingDelete,
    open: (screenshot: LocalScreenshot) => {
      requestScreenshotReview({
        gameKey: `manual:${screenshot.shop}:${screenshot.objectId ?? ""}`,
        shop: screenshot.shop,
        objectId: screenshot.objectId ?? "",
        gameTitle: getLocalScreenshotTitle(screenshot),
        clientIds: getReviewOrder(screenshots, screenshot),
      });
    },
    elements,
  };
}

export type LocalScreenshotActions = ReturnType<
  typeof useLocalScreenshotActions
>;
